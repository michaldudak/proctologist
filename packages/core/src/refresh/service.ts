import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	buildAssessmentPrompt,
	buildRetryPrompt,
	type AssessmentPromptInput,
} from "../assess/prompt.js";
import { assessmentJsonSchema, validateAssessment } from "../assess/schema.js";
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
	type PullRequestFacts,
	type Refresh,
	type RefreshCounts,
	type ReviewDraft,
} from "../store/types.js";
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
	/** Treat every open pull request as due, not only the ones that changed. */
	full?: boolean;
	/** Called once the pull requests are stored, before the record is written. */
	onFetched?: (() => void) | undefined;
}

export interface RefreshResult {
	refresh: Refresh;
	/** What the refresh found due, oldest number first. Empty when the refresh failed. */
	candidates: RefreshCandidate[];
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
	 * Fetches the open pull requests, stores them, and records the refresh. Assessing what it found
	 * due is `runAssessments`' job, so the list is current before a single agent has started.
	 */
	runRefresh: (repository: string, options?: RefreshOptions) => Promise<RefreshResult>;
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

	async function assess(
		entry: TrackedRepository,
		number: number,
		context: {
			depth: AssessmentDepth;
			cwd: string;
			hasWorkingCopy: boolean;
			defaultBranch: string;
			sandbox: "read-only" | "workspace-write";
			signal?: AbortSignal | undefined;
		},
	): Promise<Assessment> {
		const config = options.config();
		const profile = resolveProfile(
			config,
			entry.name,
			context.depth === "quick" ? "assess" : "thorough",
		);
		const bundle = await github.pullRequestBundle(entry.name, number, {
			diffCutoffKb: config.diffCutoffKb,
			signal: context.signal,
		});

		// The assessment references the pull request row, and a one-off assessment may be the first
		// time the database has seen this pull request at all.
		store.pullRequests.upsert(bundle.facts, now());

		const promptInput: AssessmentPromptInput = {
			depth: context.depth,
			bundle,
			defaultBranch: context.defaultBranch,
			repositoryContext: entry.context,
			previousAssessments: store.assessments.history({ repository: entry.name, number }, 2),
			hasWorkingCopy: context.hasWorkingCopy,
		};
		const prompt = buildAssessmentPrompt(promptInput);

		// What the run reported it used, which can be more specific than what the profile asked for.
		let model = profile.model ?? null;

		const attempt = async (text: string): Promise<unknown> => {
			const result = await agent.run<unknown>({
				prompt: text,
				cwd: context.cwd,
				sandbox: context.sandbox,
				profile,
				schema: assessmentJsonSchema,
				label: `${context.depth}-${entry.name.replaceAll("/", "-")}-${String(number)}`,
				signal: context.signal,
			});
			model = result.model ?? model;
			return result.output;
		};

		const started = Date.now();
		try {
			let output = await attempt(prompt);
			let validation = validateAssessment(output);

			if (!validation.ok) {
				output = await attempt(buildRetryPrompt(prompt, validation.issues));
				validation = validateAssessment(output);
			}

			return store.assessments.add(
				{
					repository: entry.name,
					number,
					depth: context.depth,
					headSha: bundle.facts.headSha,
					updatedAtSeen: bundle.facts.updatedAt,
					verdict: validation.ok ? validation.verdict : null,
					error: validation.ok ? null : validation.issues.join("; "),
					agent: profile.agent,
					model,
					durationMs: Date.now() - started,
				},
				now(),
			);
		} catch (cause) {
			if (cause instanceof AgentError && cause.kind === "aborted") {
				throw cause;
			}
			return store.assessments.add(
				{
					repository: entry.name,
					number,
					depth: context.depth,
					headSha: bundle.facts.headSha,
					updatedAtSeen: bundle.facts.updatedAt,
					verdict: null,
					error: cause instanceof Error ? cause.message : String(cause),
					agent: profile.agent,
					model,
					durationMs: Date.now() - started,
				},
				now(),
			);
		}
	}

	return {
		runRefresh: async (repository, refreshOptions = {}) => {
			tracked(repository);
			const config = options.config();
			const startedAt = now();
			const counts: RefreshCounts = { fetched: 0, added: 0, changed: 0, closed: 0, due: 0 };

			let facts: PullRequestFacts[];
			try {
				facts = await github.listOpenPullRequests(repository, {
					signal: refreshOptions.signal,
				});
			} catch (cause) {
				// A refresh that cannot list pull requests fails as a whole; nothing on screen changes.
				const aborted = refreshOptions.signal?.aborted ?? false;
				return {
					refresh: store.refreshes.record({
						repository,
						startedAt,
						finishedAt: now(),
						outcome: aborted ? "aborted" : "failed",
						counts,
						error: aborted ? null : cause instanceof Error ? cause.message : String(cause),
						errorKind: !aborted && cause instanceof GitHubError ? cause.kind : null,
					}),
					candidates: [],
				};
			}

			counts.fetched = facts.length;
			const before = new Map(
				store.pullRequests
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
				store.pullRequests.upsertMany(facts, fetchedAt);
				counts.closed = store.pullRequests.closeMissing(
					repository,
					facts.map((fact) => fact.number),
					fetchedAt,
				).length;
				if (config.closedRetentionDays > 0) {
					store.pullRequests.purgeClosed(repository, {
						before: new Date(
							Date.parse(fetchedAt) - config.closedRetentionDays * 86_400_000,
						).toISOString(),
					});
				}
			});

			// The pull requests are stored and worth showing before a single assessment has run.
			refreshOptions.onFetched?.();

			const due: { number: number; reason: OutdatedReason }[] = refreshOptions.full
				? store.pullRequests
						.openNumbers(repository)
						.toSorted((a, b) => a - b)
						.map((number) => ({ number, reason: "aged" as const }))
				: store.assessments.outdatedItems(repository, {
						outdatedAfterDays: config.outdatedAfterDays,
						now: fetchedAt,
					});
			const byNumber = new Map(facts.map((fact) => [fact.number, fact]));
			const candidates = due.flatMap((item): RefreshCandidate[] => {
				const fact = byNumber.get(item.number);
				return fact
					? [
							{
								number: item.number,
								title: fact.title,
								reason: item.reason,
								isBot: fact.isBot,
								isDraft: fact.isDraft,
								authoredByUser: fact.authoredByUser,
								lastActivityAt: fact.lastActivityAt,
							},
						]
					: [];
			});
			counts.due = candidates.length;

			return {
				refresh: store.refreshes.record({
					repository,
					startedAt,
					finishedAt: now(),
					outcome: "completed",
					counts,
				}),
				candidates,
			};
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

			// Every pull request is queued at once and the slot decides how many run together, so a
			// slow one never holds up the rest. Each result is stored the moment it lands.
			await Promise.all(
				numbers.map((number) =>
					slot(async () => {
						if (runOptions.signal?.aborted) {
							batch.skipped += 1;
							return;
						}
						runOptions.onItem?.(number, "running");
						try {
							const assessment = await assess(entry, number, {
								depth: "quick",
								cwd: working.cwd,
								hasWorkingCopy: working.hasWorkingCopy,
								defaultBranch,
								sandbox: "read-only",
								signal: runOptions.signal,
							});
							if (assessment.verdict) {
								batch.assessed += 1;
							} else {
								batch.unassessed += 1;
							}
							report();
						} catch (cause) {
							if (isAborted(cause) || runOptions.signal?.aborted) {
								batch.skipped += 1;
							} else {
								batch.unassessed += 1;
								report();
							}
						} finally {
							runOptions.onItem?.(number, "done");
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
				assess(entry, number, {
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
			store.pullRequests.upsert(bundle.facts, now());

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
					assess(entry, number, {
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

function localSlot(concurrency: number): AgentSlot {
	const semaphore = new Semaphore(concurrency);
	return (work) => semaphore.run(work);
}

function isAborted(reason: unknown): boolean {
	return reason instanceof AgentError && reason.kind === "aborted";
}
