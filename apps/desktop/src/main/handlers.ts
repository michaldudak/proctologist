import {
	derive,
	findRemote,
	GitError,
	toMarkdown,
	writeConfig as writeConfigFile,
	type App,
	type Assessment,
	type Config,
	type Job,
	type StoredPullRequest,
} from "@proctologist/core";
import type {
	ListPullRequestsQuery,
	NoteCommand,
	ProctologistApi,
	PullRequestDetail,
	PullRequestRow,
	RepositorySummary,
	ReviewCommand,
	SnoozeCommand,
} from "../shared/ipc.js";

export interface HandlerDependencies {
	/** Opens a URL in the user's browser. Injected so the handlers can be tested without Electron. */
	openExternal: (url: string) => Promise<void>;
	writeClipboard: (text: string) => void;
	/** Opens the platform folder picker; resolves to null when the user cancels. */
	chooseFolder: () => Promise<string | null>;
	/** Tells the renderer that stored data changed. */
	dataChanged: (repository: string | null) => void;
	now?: () => string;
}

/** Everything the renderer can call, with no Electron imports so it can be tested directly. */
export type Handlers = Omit<ProctologistApi, "on">;

export function createHandlers(app: App, deps: HandlerDependencies): Handlers {
	const now = deps.now ?? ((): string => new Date().toISOString());

	const rowFor = (pullRequest: StoredPullRequest, at: string): PullRequestRow => {
		const history = app.store.assessments.history(pullRequest, 2);
		const assessment = history[0] ?? undefined;
		const previousAssessment = history[1] ?? undefined;
		const note = app.store.notes.get(pullRequest);
		const snooze = app.store.snoozes.get(pullRequest);

		return {
			pullRequest,
			assessment: assessment ?? null,
			previousAssessment: previousAssessment ?? null,
			note: note ?? null,
			snooze: snooze ?? null,
			derived: derive(
				{ pullRequest, assessment, previousAssessment, hasNote: note !== undefined, snooze },
				at,
			),
		};
	};

	return {
		getConfig: () => Promise.resolve(app.config),
		writeConfig: async (config: Config) => {
			await writeConfigFile(config, { configFile: app.paths.configFile });
		},
		listRepositories: () => {
			const at = now();
			const running = new Map(
				app.jobs
					.list({ active: true })
					.filter((job) => job.kind === "refresh")
					.map((job) => [job.repository, job]),
			);

			return Promise.resolve(
				app.config.repositories.map((entry): RepositorySummary => {
					const rows = app.store.pullRequests
						.list(entry.name)
						.map((pullRequest) => rowFor(pullRequest, at));

					return {
						name: entry.name,
						owner: entry.owner,
						repo: entry.repo,
						clone: entry.clone ?? null,
						open: rows.length,
						quickWins: rows.filter((row) => row.derived.quickWin).length,
						unassessed: rows.filter((row) => row.derived.unassessed).length,
						lastRefresh: app.store.refreshes.latest(entry.name) ?? null,
						runningJob: running.get(entry.name) ?? null,
					};
				}),
			);
		},
		listPullRequests: (query: ListPullRequestsQuery) => {
			const at = now();
			return Promise.resolve(
				app.store.pullRequests
					.list(query.repository, { includeClosed: query.includeClosed ?? false })
					.map((pullRequest) => rowFor(pullRequest, at)),
			);
		},
		getPullRequest: async ({ repository, number }) => {
			const pullRequest = app.store.pullRequests.get({ repository, number });
			if (!pullRequest) {
				throw new Error(`${repository}#${String(number)} is not in the database.`);
			}
			const draft = app.store.reviewDrafts.latest({ repository, number });

			const detail: PullRequestDetail = {
				...rowFor(pullRequest, now()),
				history: app.store.assessments.history({ repository, number }, 20) as Assessment[],
				reviewDraft: draft ?? null,
				reviewDraftMarkdown: draft ? toMarkdown(draft) : null,
			};
			return detail;
		},
		listJobs: () => Promise.resolve(app.jobs.list({ limit: 50 })),
		refresh: ({ repository, full }) =>
			Promise.resolve(app.startRefresh(repository, { full: full ?? false })),
		refreshAll: (query = {}) => {
			const jobs: Job[] = [];
			for (const entry of app.config.repositories) {
				// A repository already refreshing is skipped rather than failing the whole command.
				try {
					jobs.push(app.startRefresh(entry.name, { full: query.full ?? false }));
				} catch {
					continue;
				}
			}
			return Promise.resolve(jobs);
		},
		abort: ({ id }) => Promise.resolve(app.jobs.abort(id)),
		assessQuick: async ({ repository, number }) => {
			await app.refresh.runQuickAssessment(repository, number);
			deps.dataChanged(repository);
		},
		assessThorough: ({ repository, number }) =>
			Promise.resolve(app.startThoroughAssessment(repository, number)),
		draftReview: ({ repository, number, effort }: ReviewCommand) =>
			Promise.resolve(app.startReviewDraft(repository, number, { effort })),
		snooze: async ({ repository, number, until }: SnoozeCommand) => {
			if (until) {
				app.store.snoozes.untilDate({ repository, number }, until, now());
			} else {
				const current = app.store.assessments.current({ repository, number });
				if (!current) {
					throw new Error(
						`${repository}#${String(number)} has no assessment to snooze until it changes.`,
					);
				}
				app.store.snoozes.untilAssessmentChanges({ repository, number }, current.id, now());
			}
			deps.dataChanged(repository);
		},
		unsnooze: ({ repository, number }) => {
			app.store.snoozes.clear({ repository, number });
			deps.dataChanged(repository);
			return Promise.resolve();
		},
		setNote: ({ repository, number, text }: NoteCommand) => {
			app.store.notes.set({ repository, number }, text, now());
			deps.dataChanged(repository);
			return Promise.resolve();
		},
		openOnGitHub: async ({ url }) => {
			// Only GitHub links, so a stored URL cannot be turned into a way to open anything.
			const parsed = new URL(url);
			if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") {
				throw new Error(`Refusing to open ${url}.`);
			}
			await deps.openExternal(parsed.toString());
		},
		copyToClipboard: ({ text }) => {
			deps.writeClipboard(text);
			return Promise.resolve();
		},
		chooseCloneFolder: () => deps.chooseFolder(),
		checkRemote: async ({ repository, clone }) => {
			try {
				const remote = await findRemote(clone, repository);
				return { ok: true, remote: remote.name, message: null };
			} catch (cause) {
				return {
					ok: false,
					remote: null,
					message:
						cause instanceof GitError ? cause.message : `Could not read the remotes of ${clone}.`,
				};
			}
		},
	};
}
