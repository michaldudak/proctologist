import {
	ISSUE,
	PULL_REQUEST,
	derive,
	findRemote,
	GitError,
	toMarkdown,
	writeConfig as writeConfigFile,
	type App,
	type Assessment,
	type Config,
	type Job,
	type StoredItem,
} from "@proctologist/core";
import type {
	AppearanceMode,
	AssessingState,
	ListItemsQuery,
	NoteCommand,
	ProctologistApi,
	ItemDetail,
	ItemRow,
	RepositorySummary,
	ReviewCommand,
	RowActivity,
	SnoozeCommand,
} from "../shared/ipc.js";

export interface HandlerDependencies {
	/** Opens a URL in the user's browser. Injected so the handlers can be tested without Electron. */
	openExternal: (url: string) => Promise<void>;
	writeClipboard: (text: string) => void;
	/** Opens the platform folder picker; resolves to null when the user cancels. */
	chooseFolder: () => Promise<string | null>;
	readLaunchAtLogin: () => boolean;
	writeLaunchAtLogin: (enabled: boolean) => void;
	/** Tints everything Electron draws itself: menus, dialogs and the window chrome. */
	writeAppearance: (mode: AppearanceMode) => void;
	/** Tells the renderer that stored data changed. */
	dataChanged: (repository: string | null) => void;
	/** When this process started; the jobs list only goes back this far. */
	sessionStartedAt: string;
	now?: () => string;
	/** Hands the renderer's answer to whichever refresh is waiting for it. */
	answerAssessments: (requestId: string, numbers: number[] | null) => void;
}

/** Everything the renderer can call, with no Electron imports so it can be tested directly. */
export type Handlers = Omit<ProctologistApi, "on" | "locale">;

export function createHandlers(app: App, deps: HandlerDependencies): Handlers {
	const now = deps.now ?? ((): string => new Date().toISOString());

	/** Which pull requests of a repository the agent is about to work on, or is working on. */
	const activityIn = (repository: string): Map<number, RowActivity> => {
		const activity = new Map<number, RowActivity>();
		// Running beats queued, should one pull request be in two jobs at once.
		const note = (number: number, job: RowActivity["job"], state: AssessingState): void => {
			if (state === "running" || !activity.has(number)) {
				activity.set(number, { job, state });
			}
		};
		for (const pending of app.pendingAssessments(repository)) {
			note(pending.number, "assessment", pending.state);
		}
		// A thorough assessment is a job of its own, but to the row it is the same wait.
		for (const job of app.jobs.list({ repository, active: true })) {
			if (job.number === null) {
				continue;
			}
			const state = job.state === "running" ? "running" : "queued";
			if (job.kind === "thorough_assessment") {
				note(job.number, "assessment", state);
			} else if (job.kind === "review_draft") {
				note(job.number, "review_draft", state);
			}
		}
		return activity;
	};

	const rowFor = (item: StoredItem, at: string, activity: Map<number, RowActivity>): ItemRow => {
		const history = app.store.assessments.history(item, 2);
		const assessment = history[0] ?? undefined;
		const previousAssessment = history[1] ?? undefined;
		const note = app.store.notes.get(item);
		const snooze = app.store.snoozes.get(item);

		return {
			item,
			assessment: assessment ?? null,
			previousAssessment: previousAssessment ?? null,
			note: note ?? null,
			snooze: snooze ?? null,
			derived: derive(
				{ item, assessment, previousAssessment, hasNote: note !== undefined, snooze },
				at,
				{ outdatedAfterDays: app.config.outdatedAfterDays },
			),
			activity: activity.get(item.number) ?? null,
			hasAnalysis: app.store.analyses.has(item),
		};
	};

	return {
		getConfig: () => Promise.resolve(app.config),
		writeConfig: async (config: Config) => {
			await writeConfigFile(config, { configFile: app.paths.configFile });
		},
		listRepositories: () =>
			Promise.resolve(
				app.config.repositories.map((entry): RepositorySummary => ({
					name: entry.name,
					owner: entry.owner,
					repo: entry.repo,
					clone: entry.clone ?? null,
					issues: entry.issues,
					open: app.store.items.list(entry.name).length,
					due: app.refresh.dueAssessments(entry.name, { skipSnoozed: true }).length,
					openIssues: entry.issues ? app.store.items.list(entry.name, { kind: ISSUE }).length : 0,
					dueIssues: entry.issues
						? app.refresh.dueTriage(entry.name, { skipSnoozed: true }).length
						: 0,
					lastRefresh: app.store.refreshes.latest(entry.name) ?? null,
				})),
			),
		listItems: (query: ListItemsQuery) => {
			const at = now();
			// A null repository is the All scope: every tracked repository in one list.
			const names =
				query.repository === null
					? app.config.repositories.map((entry) => entry.name)
					: [query.repository];
			const rows = names.flatMap((name) => {
				const activity = activityIn(name);
				return app.store.items
					.list(name, { kind: query.kind, includeClosed: query.includeClosed ?? false })
					.map((item) => rowFor(item, at, activity));
			});
			return Promise.resolve(rows);
		},
		getItem: async ({ repository, kind, number }) => {
			const ref = { repository, kind, number };
			const item = app.store.items.get(ref);
			if (!item) {
				throw new Error(`${repository}#${String(number)} is not in the database.`);
			}
			const draft = app.store.reviewDrafts.latest(ref);

			const detail: ItemDetail = {
				...rowFor(item, now(), activityIn(repository)),
				history: app.store.assessments.history(ref, 20) as Assessment[],
				analysis: app.store.analyses.latest(ref) ?? null,
				reviewDraft: draft ?? null,
				reviewDraftMarkdown: draft ? toMarkdown(draft) : null,
			};
			return detail;
		},
		listJobs: () => Promise.resolve(app.jobs.list({ since: deps.sessionStartedAt, limit: 200 })),
		refresh: ({ repository }) => Promise.resolve(app.startRefresh(repository)),
		assessDue: ({ repository, kind, full }) =>
			app.startDueAssessments(repository, {
				kind: kind ?? PULL_REQUEST,
				full: full ?? false,
				confirm: true,
			}),
		answerAssessments: ({ requestId, numbers }) => {
			deps.answerAssessments(requestId, numbers);
			return Promise.resolve();
		},
		refreshAll: () => {
			const jobs: Job[] = [];
			for (const entry of app.config.repositories) {
				// A repository already refreshing is skipped rather than failing the whole command.
				try {
					jobs.push(app.startRefresh(entry.name));
				} catch {
					continue;
				}
			}
			return Promise.resolve(jobs);
		},
		abort: ({ id }) => Promise.resolve(app.jobs.abort(id)),
		assessQuick: ({ repository, kind, number }) =>
			Promise.resolve(app.startQuickAssessment(repository, number, kind)),
		assessItems: ({ repository, kind, numbers }) =>
			Promise.resolve(app.startAssessments(repository, numbers, kind ?? PULL_REQUEST)),
		assessThorough: ({ repository, kind, number }) =>
			Promise.resolve(app.startThoroughAssessment(repository, number, kind)),
		draftReview: ({ repository, number, effort }: ReviewCommand) =>
			Promise.resolve(app.startReviewDraft(repository, number, { effort })),
		snooze: async ({ repository, kind, number, until }: SnoozeCommand) => {
			if (until) {
				app.store.snoozes.untilDate({ repository, kind, number }, until, now());
			} else {
				const current = app.store.assessments.current({ repository, kind, number });
				if (!current) {
					throw new Error(
						`${repository}#${String(number)} has no assessment to snooze until it changes.`,
					);
				}
				app.store.snoozes.untilAssessmentChanges({ repository, kind, number }, current.id, now());
			}
			deps.dataChanged(repository);
		},
		unsnooze: ({ repository, kind, number }) => {
			app.store.snoozes.clear({ repository, kind, number });
			deps.dataChanged(repository);
			return Promise.resolve();
		},
		setNote: ({ repository, kind, number, text }: NoteCommand) => {
			app.store.notes.set({ repository, kind, number }, text, now());
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
		// Each catalog carries its own error, so one missing agent does not hide the other.
		listAgentCatalogs: () => app.listAgentCatalogs(),
		getLaunchAtLogin: () => Promise.resolve(deps.readLaunchAtLogin()),
		setLaunchAtLogin: ({ enabled }) => {
			deps.writeLaunchAtLogin(enabled);
			return Promise.resolve();
		},
		setAppearance: ({ mode }) => {
			deps.writeAppearance(mode);
			return Promise.resolve();
		},
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
