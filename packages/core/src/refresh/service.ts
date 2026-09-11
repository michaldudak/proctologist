import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	buildAssessmentPrompt,
	buildRetryPrompt,
	type AssessmentPromptPullRequest,
} from "../assess/prompt.js";
import {
	assessmentJsonSchemaFor,
	validateAssessmentReply,
	type ValidationResult,
} from "../assess/schema.js";
import { AgentError, AGENT_LABELS, type AgentRunner } from "../agents/index.js";
import { GitHubError } from "../github/gh.js";
import { repositoryCacheDir } from "../config/paths.js";
import { resolveProfile, type Config, type TrackedRepository } from "../config/schema.js";
import type { EffortLevel } from "../agents/types.js";
import type { WorktreeManager } from "../git/worktrees.js";
import type { GitHubClient } from "../github/client.js";
import type { OutdatedReason } from "../store/assessments.js";
import type { Store } from "../store/store.js";
import { buildReviewPrompt } from "../review/prompt.js";
import { reviewJsonSchema, validateReview } from "../review/schema.js";
import {
	StoreError,
	type Assessment,
	type AssessmentDepth,
	type JobProgress,
	type ItemFacts,
	type Refresh,
	type RefreshCounts,
	type ReviewDraft,
} from "../store/types.js";
import { chunkEvenly } from "../util/chunks.js";
import { Semaphore } from "../util/semaphore.js";

export interface RefreshServiceOptions {
	store: Store;
	github: GitHubClient;
	worktrees: WorktreeManager;
	agent: AgentRunner;
	/** Read afresh on every run, so an edit to the config file takes effect immediately. */
	config: () => Config;
	cacheDir: string;
	now?: () => string;
}

export type AgentSlot = <T>(work: () => Promise<T>) => Promise<T>;

export interface RunOptions {
	signal?: AbortSignal | undefined;
	/** Supplied by the job runner so every agent process shares one cap. */
	agentSlot?: AgentSlot | undefined;
	onProgress?: ((progress: JobProgress) => void) | undefined;
}

/** One pull request a refresh found due for assessment, and why. */
export interface RefreshCandidate {
	number: number;
	title: string;
	reason: OutdatedReason;
	isBot: boolean;
	isDraft: boolean;
	authoredByUser: boolean;
	lastActivityAt: string;
}

export interface RefreshOptions {
	signal?: AbortSignal | undefined;
	/** Called once the pull requests are stored, before the record is written. */
	onFetched?: (() => void) | undefined;
}

export interface DueOptions {
	/** Every open pull request, not only the ones whose assessment is outdated. */
	full?: boolean | undefined;
}

/** Where one pull request is in an assessment run. */
export type AssessmentStage = "running" | "done";

export interface AssessmentRunOptions extends RunOptions {
	/** Told as each pull request starts and finishes, so a table can mark the row. */
	onItem?: ((number: number, stage: AssessmentStage) => void) | undefined;
}

export interface AssessmentBatch {
	/** Given a verdict. */
	assessed: number;
	/** Run, but left without a verdict. */
	unassessed: number;
	/** Never run, because the run was stopped first. */
	skipped: number;
}

export interface RefreshService {
	/**
	 * Fetches the open pull requests, stores them, and records the refresh, with a count of what is
	 * now due. Nothing is assessed; that waits for the user to ask.
	 */
	runRefresh: (repository: string, options?: RefreshOptions) => Promise<Refresh>;
	/**
	 * What a quick assessment is due for, oldest number first: never assessed, changed since, failed,
	 * or older than `outdated_after_days`. Read from the store, so it is only as fresh as the last
	 * refresh.
	 */
	dueAssessments: (repository: string, options?: DueOptions) => RefreshCandidate[];
	/** Quick-assesses the given pull requests, as many at a time as the agent cap allows. */
	runAssessments: (
		repository: string,
		numbers: number[],
		options?: AssessmentRunOptions,
	) => Promise<AssessmentBatch>;
	/** Re-runs a quick assessment of one pull request, outside a refresh. */
	runQuickAssessment: (
		repository: string,
		number: number,
		options?: RunOptions,
	) => Promise<Assessment>;
	runThoroughAssessment: (
		repository: string,
		number: number,
		options?: RunOptions,
	) => Promise<Assessment>;
	/** Writes a review of one pull request for the user to read and post themselves. */
	runReviewDraft: (
		repository: string,
		number: number,
		options?: ReviewDraftOptions,
	) => Promise<ReviewDraft>;
}

export interface ReviewDraftOptions extends RunOptions {
	/** Overrides the review profile's reasoning effort for this one draft. */
	effort?: EffortLevel | undefined;
}

export function createRefreshService(options: RefreshServiceOptions): RefreshService {
	const { store, github, worktrees, agent } = options;
	const now = options.now ?? ((): string => new Date().toISOString());

	const tracked = (repository: string): TrackedRepository => {
		const entry = options.config().repositories.find((item) => item.name === repository);
		if (!entry) {
			throw new StoreError(`${repository} is not a tracked repository.`);
		}
		return entry;
	};

	/** The directory the agent works in: the default-branch worktree, or an empty scratch folder. */
	const workingDirectory = async (
		entry: TrackedRepository,
	): Promise<{ cwd: string; hasWorkingCopy: boolean }> => {
		if (!entry.clone) {
			const scratch = path.join(
				repositoryCacheDir({ cacheDir: options.cacheDir }, entry.name),
				"scratch",
			);
			await mkdir(scratch, { recursive: true });
			return { cwd: scratch, hasWorkingCopy: false };
		}
		const worktree = await worktrees.defaultBranchWorktree({
			repository: entry.name,
			clone: entry.clone,
		});
		return { cwd: worktree.path, hasWorkingCopy: true };
	};

	/**
	 * Judges the given pull requests in one agent run and stores one assessment per pull request.
	 * A quick pass hands over a chunk of them at once, so the agent is spawned once per chunk rather
	 * than once per pull request; a thorough pass hands over one. Pull requests whose bundle could
	 * not be fetched are returned separately, since without facts there is nothing to store.
	 */
	async function assess(
		entry: TrackedRepository,
		numbers: number[],
		context: {
			depth: AssessmentDepth;
			cwd: string;
			hasWorkingCopy: boolean;
			defaultBranch: string;
			sandbox: "read-only" | "workspace-write";
			signal?: AbortSignal | undefined;
		},
	): Promise<{ assessments: Assessment[]; unfetched: { number: number; error: Error }[] }> {
		const config = options.config();
		const profile = resolveProfile(
			config,
			entry.name,
			context.depth === "quick" ? "assess" : "thorough",
		);

		const unfetched: { number: number; error: Error }[] = [];
		const items: AssessmentPromptPullRequest[] = [];
		const fetched = await Promise.allSettled(
			numbers.map((number) =>
				github.pullRequestBundle(entry.name, number, {
					diffCutoffKb: config.diffCutoffKb,
					signal: context.signal,
				}),
			),
		);
		for (const [index, outcome] of fetched.entries()) {
			const number = numbers[index] as number;
			if (outcome.status === "rejected") {
				const error =
					outcome.reason instanceof Error ? outcome.reason : new Error(String(outcome.reason));
				unfetched.push({ number, error });
				continue;
			}
			const bundle = outcome.value;
			// The assessment references the pull request row, and a one-off assessment may be the first
			// time the database has seen this pull request at all.
			store.items.upsert(bundle.facts, now());
			items.push({
				bundle,
				previousAssessments: store.assessments.history({ repository: entry.name, number }, 2),
			});
		}
		// A stop that lands while the bundles are being fetched leaves nothing to judge; the caller
		// counts a throw under a stop as skipped rather than as a failure.
		if (context.signal?.aborted) {
			throw unfetched[0]?.error ?? new Error("The assessment was stopped.");
		}
		if (items.length === 0) {
			return { assessments: [], unfetched };
		}

		const promptFor = (subset: AssessmentPromptPullRequest[]): string =>
			buildAssessmentPrompt({
				depth: context.depth,
				pullRequests: subset,
				defaultBranch: context.defaultBranch,
				repositoryContext: entry.context,
				thoroughInstructions: entry.thoroughInstructions,
				hasWorkingCopy: context.hasWorkingCopy,
				checkout: context.depth === "thorough" ? "pull_request_head" : "default_branch",
				// The same sum the run is given below, so the agent budgets against its real deadline.
				timeoutMinutes: profile.timeoutMinutes * subset.length,
			});
		// What the run reported it used, which can be more specific than what the profile asked for.
		let model = profile.model ?? null;

		const attempt = async (
			text: string,
			subset: AssessmentPromptPullRequest[],
		): Promise<Map<number, ValidationResult>> => {
			const covered = numbersOf(subset);
			const result = await agent.run<unknown>({
				prompt: text,
				cwd: context.cwd,
				sandbox: context.sandbox,
				// The timeout is per pull request; a run judging several gets the sum.
				profile: { ...profile, timeoutMinutes: profile.timeoutMinutes * covered.length },
				schema: assessmentJsonSchemaFor(context.depth),
				label: runLabel(context.depth, entry.name, covered),
				signal: context.signal,
			});
			model = result.model ?? model;
			return validateAssessmentReply(result.output, covered, context.depth);
		};

		const started = Date.now();
		// The analysis lands with its assessment or not at all: an assessment without the analysis
		// it was promised would read as a thorough one that had nothing to say.
		const record = (item: AssessmentPromptPullRequest, outcome: ValidationResult): Assessment =>
			store.transaction(() => {
				const assessment = store.assessments.add(
					{
						repository: entry.name,
						number: item.bundle.facts.number,
						depth: context.depth,
						headSha: item.bundle.facts.headSha,
						updatedAtSeen: item.bundle.facts.updatedAt,
						verdict: outcome.ok ? outcome.verdict : null,
						error: outcome.ok ? null : outcome.issues.join("; "),
						agent: profile.agent,
						model,
						durationMs: Date.now() - started,
					},
					now(),
				);
				if (outcome.ok && outcome.analysis !== undefined) {
					store.analyses.add(assessment.id, outcome.analysis);
				}
				return assessment;
			});

		try {
			const results = await attempt(promptFor(items), items);

			// One retry, over only the pull requests the first reply got wrong or left out.
			const rejected = items.filter((item) => {
				const outcome = results.get(item.bundle.facts.number);
				return outcome !== undefined && !outcome.ok;
			});
			if (rejected.length > 0) {
				const issues = rejected.flatMap((item) => {
					const number = item.bundle.facts.number;
					const outcome = results.get(number);
					return outcome && !outcome.ok
						? outcome.issues.map((issue) => `#${String(number)} ${issue}`)
						: [];
				});
				const retried = await attempt(buildRetryPrompt(promptFor(rejected), issues), rejected);
				for (const [number, outcome] of retried) {
					results.set(number, outcome);
				}
			}

			return {
				assessments: items.map((item) =>
					record(
						item,
						results.get(item.bundle.facts.number) ?? {
							ok: false,
							issues: ["the reply has no entry for this pull request"],
						},
					),
				),
				unfetched,
			};
		} catch (cause) {
			if (cause instanceof AgentError && cause.kind === "aborted") {
				throw cause;
			}
			const error = cause instanceof Error ? cause.message : String(cause);
			return {
				assessments: items.map((item) => record(item, { ok: false, issues: [error] })),
				unfetched,
			};
		}
	}

	/** One pull request on its own: a thorough pass, or a quick one asked for from the side panel. */
	async function assessOne(
		entry: TrackedRepository,
		number: number,
		context: Parameters<typeof assess>[2],
	): Promise<Assessment> {
		const { assessments, unfetched } = await assess(entry, [number], context);
		const [assessment] = assessments;
		if (!assessment) {
			throw unfetched[0]?.error ?? new StoreError(`#${String(number)} was not assessed.`);
		}
		return assessment;
	}

	function dueAssessments(repository: string, at: string, full = false): RefreshCandidate[] {
		const open = new Map(store.items.list(repository).map((row) => [row.number, row]));
		const due: { number: number; reason: OutdatedReason }[] = full
			? [...open.keys()].toSorted((a, b) => a - b).map((number) => ({ number, reason: "aged" }))
			: store.assessments.outdatedItems(repository, {
					outdatedAfterDays: options.config().outdatedAfterDays,
					now: at,
				});
		return due.flatMap((item): RefreshCandidate[] => {
			const row = open.get(item.number);
			return row
				? [
						{
							number: item.number,
							title: row.title,
							reason: item.reason,
							isBot: row.isBot,
							isDraft: row.isDraft,
							authoredByUser: row.authoredByUser,
							lastActivityAt: row.lastActivityAt,
						},
					]
				: [];
		});
	}

	return {
		runRefresh: async (repository, refreshOptions = {}) => {
			tracked(repository);
			const config = options.config();
			const startedAt = now();
			const counts: RefreshCounts = { fetched: 0, added: 0, changed: 0, closed: 0, due: 0 };

			let facts: ItemFacts[];
			try {
				facts = await github.listOpenPullRequests(repository, {
					signal: refreshOptions.signal,
				});
			} catch (cause) {
				// A refresh that cannot list pull requests fails as a whole; nothing on screen changes.
				const aborted = refreshOptions.signal?.aborted ?? false;
				return store.refreshes.record({
					repository,
					startedAt,
					finishedAt: now(),
					outcome: aborted ? "aborted" : "failed",
					counts,
					error: aborted ? null : cause instanceof Error ? cause.message : String(cause),
					errorKind: !aborted && cause instanceof GitHubError ? cause.kind : null,
				});
			}

			counts.fetched = facts.length;
			const before = new Map(
				store.items
					.list(repository, { includeClosed: true })
					.map((stored) => [stored.number, stored]),
			);
			for (const fact of facts) {
				const stored = before.get(fact.number);
				if (!stored || stored.closedAt !== null) {
					counts.added += 1;
				} else if (stored.headSha !== fact.headSha || stored.updatedAt !== fact.updatedAt) {
					counts.changed += 1;
				}
			}

			const fetchedAt = now();
			store.transaction(() => {
				store.items.upsertMany(facts, fetchedAt);
				counts.closed = store.items.closeMissing(
					repository,
					facts.map((fact) => fact.number),
					fetchedAt,
				).length;
				if (config.closedRetentionDays > 0) {
					store.items.purgeClosed(repository, {
						before: new Date(
							Date.parse(fetchedAt) - config.closedRetentionDays * 86_400_000,
						).toISOString(),
					});
				}
			});

			// The pull requests are stored and worth showing before a single assessment has run.
			refreshOptions.onFetched?.();

			counts.due = dueAssessments(repository, fetchedAt).length;

			return store.refreshes.record({
				repository,
				startedAt,
				finishedAt: now(),
				outcome: "completed",
				counts,
			});
		},
		dueAssessments: (repository, dueOptions = {}) => {
			tracked(repository);
			return dueAssessments(repository, now(), dueOptions.full ?? false);
		},
		runAssessments: async (repository, numbers, runOptions = {}) => {
			const entry = tracked(repository);
			const batch: AssessmentBatch = { assessed: 0, unassessed: 0, skipped: 0 };
			if (numbers.length === 0) {
				return batch;
			}

			const config = options.config();
			const defaultBranch = await github.defaultBranch(repository);
			const working = await workingDirectory(entry);
			const slot = runOptions.agentSlot ?? localSlot(config.concurrency);
			const report = (): void => {
				runOptions.onProgress?.({
					done: batch.assessed + batch.unassessed,
					total: numbers.length,
					failed: batch.unassessed,
					label: `Assessed ${String(batch.assessed + batch.unassessed)} of ${String(numbers.length)}`,
				});
			};
			report();

			// The pull requests are dealt into chunks of up to `assessment_chunk_size`, each one agent
			// run, and every chunk is queued at once with the slot deciding how many run together. A
			// chunk's results are stored the moment it lands, so a slow chunk never holds up the rest.
			await Promise.all(
				chunkEvenly(numbers, config.assessmentChunkSize).map((chunk) =>
					slot(async () => {
						if (runOptions.signal?.aborted) {
							batch.skipped += chunk.length;
							return;
						}
						for (const number of chunk) {
							runOptions.onItem?.(number, "running");
						}
						try {
							const { assessments, unfetched } = await assess(entry, chunk, {
								depth: "quick",
								cwd: working.cwd,
								hasWorkingCopy: working.hasWorkingCopy,
								defaultBranch,
								sandbox: "read-only",
								signal: runOptions.signal,
							});
							for (const assessment of assessments) {
								if (assessment.verdict) {
									batch.assessed += 1;
								} else {
									batch.unassessed += 1;
								}
							}
							batch.unassessed += unfetched.length;
							report();
						} catch (cause) {
							if (isAborted(cause) || runOptions.signal?.aborted) {
								batch.skipped += chunk.length;
							} else {
								batch.unassessed += chunk.length;
								report();
							}
						} finally {
							for (const number of chunk) {
								runOptions.onItem?.(number, "done");
							}
						}
					}),
				),
			);

			return batch;
		},
		runQuickAssessment: async (repository, number, runOptions = {}) => {
			const entry = tracked(repository);
			const defaultBranch = await github.defaultBranch(repository);
			const working = await workingDirectory(entry);
			const slot = runOptions.agentSlot ?? ((work) => work());

			runOptions.onProgress?.({ done: 0, total: 1, label: `Assessing #${String(number)}` });
			const assessment = await slot(() =>
				assessOne(entry, number, {
					depth: "quick",
					cwd: working.cwd,
					hasWorkingCopy: working.hasWorkingCopy,
					defaultBranch,
					sandbox: "read-only",
					signal: runOptions.signal,
				}),
			);
			runOptions.onProgress?.({ done: 1, total: 1 });
			return assessment;
		},
		runReviewDraft: async (repository, number, runOptions = {}) => {
			const entry = tracked(repository);
			if (!entry.clone) {
				throw new StoreError(
					`Drafting a review of ${repository} needs a local clone; set \`clone\` in the config.`,
				);
			}

			const config = options.config();
			const base = resolveProfile(config, repository, "review");
			const profile = runOptions.effort ? { ...base, effort: runOptions.effort } : base;
			const defaultBranch = await github.defaultBranch(repository);
			const bundle = await github.pullRequestBundle(repository, number, {
				diffCutoffKb: config.diffCutoffKb,
				signal: runOptions.signal,
			});
			// The draft references the pull request row, which a one-off review may be the first to see.
			store.items.upsert(bundle.facts, now());

			const worktree = await worktrees.pullHeadWorktree({ repository, clone: entry.clone }, number);
			const slot = runOptions.agentSlot ?? ((work) => work());

			try {
				runOptions.onProgress?.({ done: 0, total: 1, label: `Reviewing #${String(number)}` });
				const result = await slot(() =>
					agent.run<unknown>({
						prompt: buildReviewPrompt({
							bundle,
							defaultBranch,
							reviewInstructions: entry.reviewInstructions,
							effort: profile.effort,
						}),
						cwd: worktree.path,
						sandbox: "workspace-write",
						profile,
						schema: reviewJsonSchema,
						// The session is kept so a follow-up can carry on the same conversation.
						ephemeral: false,
						label: `review-${repository.replaceAll("/", "-")}-${String(number)}`,
						signal: runOptions.signal,
					}),
				);

				const validation = validateReview(result.output);
				if (!validation.ok) {
					throw new StoreError(
						`${AGENT_LABELS[profile.agent]}'s review did not match the schema: ${validation.issues.join("; ")}`,
					);
				}

				const draft = store.reviewDrafts.add(
					{
						repository,
						number,
						headSha: worktree.commit,
						summary: validation.draft.summary,
						verdict: validation.draft.verdict,
						findings: validation.draft.findings,
						sessionId: result.sessionId,
						agent: result.agent,
						model: result.model,
					},
					now(),
				);
				runOptions.onProgress?.({ done: 1, total: 1 });
				return draft;
			} finally {
				await worktree.release();
			}
		},
		runThoroughAssessment: async (repository, number, runOptions = {}) => {
			const entry = tracked(repository);
			if (!entry.clone) {
				throw new StoreError(
					`A thorough assessment of ${repository} needs a local clone; set \`clone\` in the config.`,
				);
			}

			const defaultBranch = await github.defaultBranch(repository);
			const worktree = await worktrees.pullHeadWorktree({ repository, clone: entry.clone }, number);
			const slot = runOptions.agentSlot ?? ((work) => work());

			try {
				runOptions.onProgress?.({ done: 0, total: 1, label: `Assessing #${String(number)}` });
				const assessment = await slot(() =>
					assessOne(entry, number, {
						depth: "thorough",
						cwd: worktree.path,
						hasWorkingCopy: true,
						defaultBranch,
						sandbox: "workspace-write",
						signal: runOptions.signal,
					}),
				);
				runOptions.onProgress?.({ done: 1, total: 1 });
				return assessment;
			} finally {
				await worktree.release();
			}
		},
	};
}

function numbersOf(items: AssessmentPromptPullRequest[]): number[] {
	return items.map((item) => item.bundle.facts.number);
}

/** `quick-owner-thing-101` for one pull request, `quick-owner-thing-101-to-116` for a chunk. */
function runLabel(depth: AssessmentDepth, repository: string, numbers: number[]): string {
	const first = numbers[0] ?? 0;
	const last = numbers.at(-1) ?? first;
	const range = numbers.length > 1 ? `${String(first)}-to-${String(last)}` : String(first);
	return `${depth}-${repository.replaceAll("/", "-")}-${range}`;
}

function localSlot(concurrency: number): AgentSlot {
	const semaphore = new Semaphore(concurrency);
	return (work) => semaphore.run(work);
}

function isAborted(reason: unknown): boolean {
	return reason instanceof AgentError && reason.kind === "aborted";
}
