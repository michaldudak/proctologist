import { randomUUID } from "node:crypto";
import { readModelCatalog, type CodexModel } from "./codex/catalog.js";
import { createCodexRunner, type CodexRunner } from "./codex/runner.js";
import { loadConfig, type ConfigLocationOptions } from "./config/file.js";
import type { AppPaths } from "./config/paths.js";
import type { Config, ReasoningEffort } from "./config/schema.js";
import { createWorktreeManager, type WorktreeManager } from "./git/worktrees.js";
import { createGitHubClient, type GitHubClient } from "./github/client.js";
import { createJobRunner, type JobRunner } from "./jobs/runner.js";
import { createRefreshService, type RefreshService } from "./refresh/service.js";
import { openStore, type Store } from "./store/store.js";
import type { Job } from "./store/types.js";

export interface CreateAppOptions extends ConfigLocationOptions {
	/** Executable paths, so tests and packaged builds can point elsewhere. */
	ghPath?: string;
	gitPath?: string;
	codexPath?: string;
	/** Override where the database lives, for tests. */
	databaseFile?: string;
}

/** Everything wired together. Both the CLI and the desktop main process start here. */
export interface App {
	config: Config;
	paths: AppPaths;
	store: Store;
	github: GitHubClient;
	worktrees: WorktreeManager;
	codex: CodexRunner;
	refresh: RefreshService;
	jobs: JobRunner;
	/** Queues a refresh of one repository and returns the job. */
	startRefresh: (repository: string, options?: { full?: boolean }) => Job;
	startThoroughAssessment: (repository: string, number: number) => Job;
	/** The models and reasoning levels the local Codex accepts. Read once and remembered. */
	listCodexModels: () => Promise<CodexModel[]>;
	startReviewDraft: (
		repository: string,
		number: number,
		options?: { effort?: ReasoningEffort },
	) => Job;
	/** Re-reads the config file. Existing jobs keep the settings they started with. */
	reloadConfig: () => Promise<Config>;
	close: () => Promise<void>;
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
	const codex = createCodexRunner({
		codexPath: options.codexPath,
		logDir: `${paths.cacheDir}/logs`,
	});
	const refresh = createRefreshService({
		store,
		github,
		worktrees,
		codex,
		cacheDir: paths.cacheDir,
		config: () => config,
	});

	// The extra arguments a job needs but the database does not keep.
	const refreshOptions = new Map<string, { full?: boolean }>();
	const reviewOptions = new Map<string, { effort?: ReasoningEffort }>();
	let catalog: Promise<CodexModel[]> | undefined;

	const jobs = createJobRunner({
		store,
		concurrency: config.concurrency,
		handlers: {
			refresh: async ({ job, signal, setProgress, codexSlot }) => {
				const record = await refresh.runRefresh(job.repository, {
					full: refreshOptions.get(job.id)?.full,
					signal,
					codexSlot,
					onProgress: setProgress,
				});
				refreshOptions.delete(job.id);
				// A refresh that could not even list the pull requests has failed, and the job that ran
				// it should say so rather than reporting success.
				if (record.outcome === "failed") {
					throw new Error(record.error ?? "The refresh failed.");
				}
			},
			thorough_assessment: async ({ job, signal, setProgress, codexSlot }) => {
				if (job.number === null) {
					throw new Error("A thorough assessment needs a pull request number.");
				}
				await refresh.runThoroughAssessment(job.repository, job.number, {
					signal,
					codexSlot,
					onProgress: setProgress,
				});
			},
			review_draft: async ({ job, signal, setProgress, codexSlot }) => {
				if (job.number === null) {
					throw new Error("A review draft needs a pull request number.");
				}
				await refresh.runReviewDraft(job.repository, job.number, {
					effort: reviewOptions.get(job.id)?.effort,
					signal,
					codexSlot,
					onProgress: setProgress,
				});
				reviewOptions.delete(job.id);
			},
		},
	});

	return {
		get config() {
			return config;
		},
		paths,
		store,
		github,
		worktrees,
		codex,
		refresh,
		jobs,
		startRefresh: (repository, startOptions = {}) => {
			// The options have to be in place before the handler starts, which enqueue does at once.
			const id = randomUUID();
			refreshOptions.set(id, startOptions);
			try {
				return jobs.enqueue({ id, kind: "refresh", repository });
			} catch (cause) {
				refreshOptions.delete(id);
				throw cause;
			}
		},
		listCodexModels: () => {
			catalog ??= readModelCatalog({ codexPath: options.codexPath });
			return catalog;
		},
		startThoroughAssessment: (repository, number) =>
			jobs.enqueue({ kind: "thorough_assessment", repository, number }),
		startReviewDraft: (repository, number, startOptions = {}) => {
			const id = randomUUID();
			reviewOptions.set(id, startOptions);
			try {
				return jobs.enqueue({ id, kind: "review_draft", repository, number });
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
