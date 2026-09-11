import { randomUUID } from "node:crypto";
import { readAgentCatalogs } from "./agents/catalogs.js";
import type { AgentCatalog } from "./agents/catalog.js";
import { createAgentRunner } from "./agents/runner.js";
import type { AgentKind, AgentRunner, EffortLevel } from "./agents/types.js";
import { loadConfig, type ConfigLocationOptions } from "./config/file.js";
import type { AppPaths } from "./config/paths.js";
import type { Config } from "./config/schema.js";
import { createWorktreeManager, type WorktreeManager } from "./git/worktrees.js";
import { createGitHubClient, type GitHubClient } from "./github/client.js";
import { createJobRunner, type JobRunner } from "./jobs/runner.js";
import {
	createRefreshService,
	type AssessmentStage,
	type RefreshCandidate,
	type RefreshService,
} from "./refresh/service.js";
import { openStore, type Store } from "./store/store.js";
import { ISSUE, PULL_REQUEST, type ItemKind, type Job, type RefreshCounts } from "./store/types.js";

export interface StartDueAssessmentsOptions {
	/** Which kind is due: pull requests are assessed, issues are triaged. */
	kind?: ItemKind;
	/** Every open item, not only the ones whose assessment is outdated. */
	full?: boolean;
	/** Whether to ask before assessing a lot of pull requests. The CLI does not ask. */
	confirm?: boolean;
}

/** Where one pull request stands in the assessment queue. */
export type PendingState = "queued" | "running";

export interface PendingAssessment {
	number: number;
	state: PendingState;
}

export interface CreateAppOptions extends ConfigLocationOptions {
	/** Executable paths, so tests and packaged builds can point elsewhere. */
	ghPath?: string;
	gitPath?: string;
	/** Where each agent's CLI lives, when it is not simply on PATH. */
	agentPaths?: Partial<Record<AgentKind, string>>;
	/** Override where the database lives, for tests. */
	databaseFile?: string;
	/** Told whenever stored data changed, so a window can re-read it. */
	onDataChanged?: (repository: string) => void;
	/**
	 * Asked which pull requests to assess when more of them are due than
	 * `confirm_assessments_above`. Returning null cancels. Without it, every candidate is assessed.
	 */
	confirmTargets?: (repository: string, candidates: RefreshCandidate[]) => Promise<number[] | null>;
}

/** Everything wired together. Both the CLI and the desktop main process start here. */
export interface App {
	config: Config;
	paths: AppPaths;
	store: Store;
	github: GitHubClient;
	worktrees: WorktreeManager;
	agent: AgentRunner;
	refresh: RefreshService;
	jobs: JobRunner;
	/** Queues a refresh of one repository and returns the job. It fetches; it never assesses. */
	startRefresh: (repository: string) => Job;
	/**
	 * Queues quick assessments of everything the last refresh left due, or of every open pull
	 * request with `full`, as one job. Null when there is nothing to assess, or the user, asked which
	 * ones, chose none.
	 */
	startDueAssessments: (
		repository: string,
		options?: StartDueAssessmentsOptions,
	) => Promise<Job | null>;
	/** Queues quick assessments of the given pull requests as one job. */
	startAssessments: (repository: string, numbers: number[]) => Job;
	/** Queues a quick assessment of one item, the way the side panel asks for it. */
	startQuickAssessment: (repository: string, number: number, kind?: ItemKind) => Job;
	/** Which pull requests an assessment job is about to run, or is running, right now. */
	pendingAssessments: (repository: string) => PendingAssessment[];
	startThoroughAssessment: (repository: string, number: number, kind?: ItemKind) => Job;
	/** What each installed agent says it can do. Read once and remembered. */
	listAgentCatalogs: () => Promise<Record<AgentKind, AgentCatalog>>;
	startReviewDraft: (repository: string, number: number, options?: { effort?: EffortLevel }) => Job;
	/** Re-reads the config file. Existing jobs keep the settings they started with. */
	reloadConfig: () => Promise<Config>;
	close: () => Promise<void>;
}

/** "45 open, 2 new, 1 closed, 12 to assess": what a refresh found, in one line. */
function describeCounts(counts: RefreshCounts): string {
	return [
		`${String(counts.fetched)} open`,
		counts.added > 0 ? `${String(counts.added)} new` : null,
		counts.closed > 0 ? `${String(counts.closed)} closed` : null,
		`${String(counts.due)} to assess`,
	]
		.filter((part): part is string => part !== null)
		.join(", ");
}

export async function createApp(options: CreateAppOptions = {}): Promise<App> {
	const loaded = await loadConfig(options);
	let config = loaded.config;
	const paths = loaded.paths;

	const store = openStore(options.databaseFile ?? paths.databaseFile);
	const github = createGitHubClient({ ghPath: options.ghPath });
	const worktrees = createWorktreeManager({
		cacheDir: paths.cacheDir,
		gitPath: options.gitPath,
	});
	const agent = createAgentRunner({
		agentPaths: options.agentPaths,
		logDir: `${paths.cacheDir}/logs`,
	});
	const refresh = createRefreshService({
		store,
		github,
		worktrees,
		agent,
		cacheDir: paths.cacheDir,
		config: () => config,
	});

	// The extra arguments a job needs but the database does not keep.
	const reviewOptions = new Map<string, { effort?: EffortLevel }>();
	/** The pull requests each assessment job is for, and where each of them has got to. */
	const assessmentQueues = new Map<
		string,
		{ repository: string; items: Map<number, PendingState> }
	>();
	let catalogs: Promise<Record<AgentKind, AgentCatalog>> | undefined;

	const dataChanged = (repository: string): void => options.onDataChanged?.(repository);

	const startAssessments = (
		repository: string,
		numbers: number[],
		kind: ItemKind = PULL_REQUEST,
	): Job => {
		const id = randomUUID();
		assessmentQueues.set(id, {
			repository,
			items: new Map(numbers.map((number) => [number, "queued" as const])),
		});
		try {
			const job = jobs.enqueue({
				id,
				kind: "assessment",
				repository,
				kindOfItem: kind,
				// A job about one pull request says so, so the side panel can find it.
				number: numbers.length === 1 ? (numbers[0] ?? null) : null,
				progress: { done: 0, total: numbers.length, failed: 0 },
				// One assessment run per repository at a time, or the rows would fill in twice over.
				queueKey: `assessment:${repository}:${kind}`,
			});
			dataChanged(repository);
			return job;
		} catch (cause) {
			assessmentQueues.delete(id);
			throw cause;
		}
	};

	const jobs = createJobRunner({
		store,
		concurrency: config.concurrency,
		handlers: {
			refresh: async ({ job, signal, setProgress }) => {
				setProgress({ done: 0, total: 1, label: "Fetching pull requests" });
				const record = await refresh.runRefresh(job.repository, {
					signal,
					onFetched: () => dataChanged(job.repository),
				});
				// A refresh that could not even list the pull requests has failed, and the job that ran
				// it should say so rather than reporting success.
				if (record.outcome === "failed") {
					throw new Error(record.error ?? "The refresh failed.");
				}
				// The job's last word is the refresh's summary, so a jobs list can show what it found.
				setProgress({ done: 1, total: 1, label: describeCounts(record.counts) });
			},
			assessment: async ({ job, signal, setProgress, agentSlot }) => {
				const queue = assessmentQueues.get(job.id);
				const numbers = queue ? [...queue.items.keys()] : job.number === null ? [] : [job.number];
				// The same job kind for both; `item_kind` is what says which one it works through.
				const run = job.itemKind === ISSUE ? refresh.runTriage : refresh.runAssessments;
				try {
					await run(job.repository, numbers, {
						signal,
						agentSlot,
						onProgress: setProgress,
						onItem: (number, stage: AssessmentStage) => {
							if (stage === "running") {
								queue?.items.set(number, "running");
							} else {
								queue?.items.delete(number);
							}
							dataChanged(job.repository);
						},
					});
				} finally {
					assessmentQueues.delete(job.id);
					dataChanged(job.repository);
				}
			},
			thorough_assessment: async ({ job, signal, setProgress, agentSlot }) => {
				if (job.number === null) {
					throw new Error("A thorough assessment needs an item number.");
				}
				// The row shows the agent at work from here; the job's end announces itself.
				dataChanged(job.repository);
				const runThorough =
					job.itemKind === ISSUE ? refresh.runThoroughTriage : refresh.runThoroughAssessment;
				await runThorough(job.repository, job.number, {
					signal,
					agentSlot,
					onProgress: setProgress,
				});
			},
			review_draft: async ({ job, signal, setProgress, agentSlot }) => {
				if (job.number === null) {
					throw new Error("A review draft needs a pull request number.");
				}
				// The row shows the agent at work from here; the job's end announces itself.
				dataChanged(job.repository);
				await refresh.runReviewDraft(job.repository, job.number, {
					effort: reviewOptions.get(job.id)?.effort,
					signal,
					agentSlot,
					onProgress: setProgress,
				});
				reviewOptions.delete(job.id);
			},
		},
	});

	/** Only asks when there are enough of them to be worth asking about. */
	const chooseTargets = async (
		repository: string,
		candidates: RefreshCandidate[],
	): Promise<number[] | null> => {
		const threshold = config.confirmAssessmentsAbove;
		if (threshold <= 0 || candidates.length <= threshold || !options.confirmTargets) {
			return candidates.map((candidate) => candidate.number);
		}
		return options.confirmTargets(repository, candidates);
	};

	return {
		get config() {
			return config;
		},
		paths,
		store,
		github,
		worktrees,
		agent,
		refresh,
		jobs,
		startRefresh: (repository) => jobs.enqueue({ kind: "refresh", repository }),
		startDueAssessments: async (repository, startOptions = {}) => {
			const kind = startOptions.kind ?? PULL_REQUEST;
			const candidates =
				kind === ISSUE
					? refresh.dueTriage(repository, { full: startOptions.full })
					: refresh.dueAssessments(repository, { full: startOptions.full });
			if (candidates.length === 0) {
				return null;
			}
			const chosen = startOptions.confirm
				? await chooseTargets(repository, candidates)
				: candidates.map((candidate) => candidate.number);
			if (chosen === null || chosen.length === 0) {
				return null;
			}
			return startAssessments(repository, chosen, kind);
		},
		listAgentCatalogs: () => {
			catalogs ??= readAgentCatalogs({ agentPaths: options.agentPaths });
			return catalogs;
		},
		startAssessments,
		startQuickAssessment: (repository, number, kind = PULL_REQUEST) =>
			startAssessments(repository, [number], kind),
		pendingAssessments: (repository) => {
			const pending = new Map<number, PendingState>();
			for (const queue of assessmentQueues.values()) {
				if (queue.repository !== repository) {
					continue;
				}
				for (const [number, state] of queue.items) {
					// Running beats queued, should one pull request be in two jobs at once.
					if (state === "running" || !pending.has(number)) {
						pending.set(number, state);
					}
				}
			}
			return [...pending].map(([number, state]) => ({ number, state }));
		},
		startThoroughAssessment: (repository, number, kind = PULL_REQUEST) => {
			const job = jobs.enqueue({
				kind: "thorough_assessment",
				repository,
				number,
				kindOfItem: kind,
			});
			// Queued is already something the row can show.
			dataChanged(repository);
			return job;
		},
		startReviewDraft: (repository, number, startOptions = {}) => {
			const id = randomUUID();
			reviewOptions.set(id, startOptions);
			try {
				const job = jobs.enqueue({ id, kind: "review_draft", repository, number });
				// Queued is already something the row can show.
				dataChanged(repository);
				return job;
			} catch (cause) {
				reviewOptions.delete(id);
				throw cause;
			}
		},
		reloadConfig: async () => {
			config = (await loadConfig(options)).config;
			return config;
		},
		close: async () => {
			await jobs.shutdown();
			store.close();
		},
	};
}
