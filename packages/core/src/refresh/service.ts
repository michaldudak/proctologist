import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	buildAssessmentPrompt,
	buildRetryPrompt,
	type AssessmentPromptInput,
} from "../assess/prompt.js";
import { assessmentJsonSchema, validateAssessment } from "../assess/schema.js";
import { CodexError, type CodexRunner } from "../codex/runner.js";
import { repositoryCacheDir } from "../config/paths.js";
import {
	resolveCodexProfile,
	type Config,
	type ReasoningEffort,
	type TrackedRepository,
} from "../config/schema.js";
import type { WorktreeManager } from "../git/worktrees.js";
import type { GitHubClient } from "../github/client.js";
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
	codex: CodexRunner;
	/** Read afresh on every run, so an edit to the config file takes effect immediately. */
	config: () => Config;
	cacheDir: string;
	now?: () => string;
}

export type CodexSlot = <T>(work: () => Promise<T>) => Promise<T>;

export interface RunOptions {
	signal?: AbortSignal | undefined;
	/** Supplied by the job runner so every Codex process shares one cap. */
	codexSlot?: CodexSlot | undefined;
	onProgress?: ((progress: JobProgress) => void) | undefined;
}

export interface RefreshOptions extends RunOptions {
	/** Re-assess every open pull request, not only the ones that changed. */
	full?: boolean;
}

export interface RefreshService {
	runRefresh: (repository: string, options?: RefreshOptions) => Promise<Refresh>;
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
	effort?: ReasoningEffort | undefined;
}

export function createRefreshService(options: RefreshServiceOptions): RefreshService {
	const { store, github, worktrees, codex } = options;
	const now = options.now ?? ((): string => new Date().toISOString());

	const tracked = (repository: string): TrackedRepository => {
		const entry = options.config().repositories.find((item) => item.name === repository);
		if (!entry) {
			throw new StoreError(`${repository} is not a tracked repository.`);
		}
		return entry;
	};

	/** The directory Codex works in: the default-branch worktree, or an empty scratch folder. */
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
		const profile = resolveCodexProfile(
			config,
			entry.name,
			context.depth === "quick" ? "assess" : "thorough",
		);
		const bundle = await github.pullRequestBundle(entry.name, number, {
			diffCutoffKb: config.diffCutoffKb,
			signal: context.signal,
		});

		const promptInput: AssessmentPromptInput = {
			depth: context.depth,
			bundle,
			defaultBranch: context.defaultBranch,
			repositoryContext: entry.context,
			previousAssessments: store.assessments.history({ repository: entry.name, number }, 2),
			hasWorkingCopy: context.hasWorkingCopy,
		};
		const prompt = buildAssessmentPrompt(promptInput);

		const attempt = async (text: string): Promise<{ output: unknown; durationMs: number }> => {
			const result = await codex.run<unknown>({
				prompt: text,
				cwd: context.cwd,
				sandbox: context.sandbox,
				profile,
				schema: assessmentJsonSchema,
				label: `${context.depth}-${entry.name.replaceAll("/", "-")}-${String(number)}`,
				signal: context.signal,
			});
			return { output: result.output, durationMs: result.durationMs };
		};

		const started = Date.now();
		try {
			let run = await attempt(prompt);
			let validation = validateAssessment(run.output);

			if (!validation.ok) {
				run = await attempt(buildRetryPrompt(prompt, validation.issues));
				validation = validateAssessment(run.output);
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
					model: profile.model ?? null,
					durationMs: Date.now() - started,
				},
				now(),
			);
		} catch (cause) {
			if (cause instanceof CodexError && cause.kind === "aborted") {
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
					model: profile.model ?? null,
					durationMs: Date.now() - started,
				},
				now(),
			);
		}
	}

	return {
		runRefresh: async (repository, refreshOptions = {}) => {
			const entry = tracked(repository);
			const config = options.config();
			const startedAt = now();
			const counts: RefreshCounts = {
				fetched: 0,
				added: 0,
				changed: 0,
				reassessed: 0,
				unassessed: 0,
				closed: 0,
			};

			let facts: PullRequestFacts[];
			try {
				facts = await github.listOpenPullRequests(repository, {
					signal: refreshOptions.signal,
				});
			} catch (cause) {
				// A refresh that cannot list pull requests fails as a whole; nothing on screen changes.
				return store.refreshes.record({
					repository,
					startedAt,
					finishedAt: now(),
					outcome: "failed",
					counts,
					error: cause instanceof Error ? cause.message : String(cause),
				});
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
			});

			const targets = refreshOptions.full
				? store.pullRequests.openNumbers(repository).toSorted((a, b) => a - b)
				: store.assessments.outdated(repository, {
						outdatedAfterDays: config.outdatedAfterDays,
						now: fetchedAt,
					});

			let outcome: Refresh["outcome"] = "completed";
			let error: string | null = null;

			if (targets.length > 0) {
				const defaultBranch = await github.defaultBranch(repository);
				const working = await workingDirectory(entry);
				const slot = refreshOptions.codexSlot ?? localSlot(config.concurrency);
				let done = 0;

				const results = await Promise.allSettled(
					targets.map((number) =>
						slot(async () => {
							if (refreshOptions.signal?.aborted) {
								throw new CodexError("aborted", "Refresh aborted.", { logPath: "" });
							}
							const assessment = await assess(entry, number, {
								depth: "quick",
								cwd: working.cwd,
								hasWorkingCopy: working.hasWorkingCopy,
								defaultBranch,
								sandbox: "read-only",
								signal: refreshOptions.signal,
							});
							done += 1;
							refreshOptions.onProgress?.({
								done,
								total: targets.length,
								label: `Assessed ${String(done)} of ${String(targets.length)}`,
							});
							return assessment;
						}),
					),
				);

				for (const result of results) {
					if (result.status === "fulfilled") {
						if (result.value.verdict) {
							counts.reassessed += 1;
						} else {
							counts.unassessed += 1;
						}
					} else if (isAborted(result.reason)) {
						outcome = "aborted";
					} else {
						counts.unassessed += 1;
						error ??=
							result.reason instanceof Error ? result.reason.message : String(result.reason);
					}
				}
				if (refreshOptions.signal?.aborted) {
					outcome = "aborted";
				}
			}

			if (config.closedRetentionDays > 0) {
				store.pullRequests.purgeClosed(repository, {
					before: new Date(
						Date.parse(fetchedAt) - config.closedRetentionDays * 86_400_000,
					).toISOString(),
				});
			}

			return store.refreshes.record({
				repository,
				startedAt,
				finishedAt: now(),
				outcome,
				counts,
				error,
			});
		},
		runQuickAssessment: async (repository, number, runOptions = {}) => {
			const entry = tracked(repository);
			const defaultBranch = await github.defaultBranch(repository);
			const working = await workingDirectory(entry);
			const slot = runOptions.codexSlot ?? ((work) => work());

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
			const base = resolveCodexProfile(config, repository, "review");
			const profile = runOptions.effort ? { ...base, reasoningEffort: runOptions.effort } : base;
			const defaultBranch = await github.defaultBranch(repository);
			const bundle = await github.pullRequestBundle(repository, number, {
				diffCutoffKb: config.diffCutoffKb,
				signal: runOptions.signal,
			});
			const worktree = await worktrees.pullHeadWorktree({ repository, clone: entry.clone }, number);
			const slot = runOptions.codexSlot ?? ((work) => work());

			try {
				runOptions.onProgress?.({ done: 0, total: 1, label: `Reviewing #${String(number)}` });
				const result = await slot(() =>
					codex.run<unknown>({
						prompt: buildReviewPrompt({
							bundle,
							defaultBranch,
							reviewInstructions: entry.reviewInstructions,
							effort: profile.reasoningEffort,
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
						`Codex's review did not match the schema: ${validation.issues.join("; ")}`,
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
						model: profile.model ?? null,
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
			const slot = runOptions.codexSlot ?? ((work) => work());

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

function localSlot(concurrency: number): CodexSlot {
	const semaphore = new Semaphore(concurrency);
	return (work) => semaphore.run(work);
}

function isAborted(reason: unknown): boolean {
	return reason instanceof CodexError && reason.kind === "aborted";
}
