import { randomUUID } from "node:crypto";
import { app, clipboard, dialog, nativeTheme, powerMonitor, shell } from "electron";
import { createApp, type App as Core, type Job, type RefreshCandidate } from "@proctologist/core";
import { watchConfig } from "@proctologist/core";
import { createHandlers } from "./handlers.js";
import { registerIpc } from "./ipc.js";
import { assessmentNotification, notify, refreshNotification } from "./notifications.js";
import { createScheduler } from "./scheduler.js";
import { inheritLoginShellPath } from "./shell-path.js";
import { createMainWindow, type MainWindow } from "./window.js";
import { CHANNEL_PREFIX } from "../shared/ipc.js";

// A second copy would fight over the database and the refresh lock.
if (!app.requestSingleInstanceLock()) {
	app.quit();
}

let core: Core | undefined;
let window: MainWindow | undefined;
let quitting = false;
/** Refreshes waiting for the window to say which pull requests to assess. */
const pendingQuestions = new Map<string, (numbers: number[] | null) => void>();

function send(channel: string, payload: unknown): void {
	window?.send(`${CHANNEL_PREFIX}${channel}`, payload);
}

/**
 * Asks the window which of the candidates to assess. Without a window to ask, everything is
 * assessed, which is what a refresh started anywhere else already does.
 */
async function askAboutAssessments(
	repository: string,
	candidates: RefreshCandidate[],
): Promise<number[] | null> {
	if (!window) {
		return candidates.map((candidate) => candidate.number);
	}

	const requestId = randomUUID();
	window.show();
	send("confirm-assessments", { requestId, repository, candidates });

	return new Promise<number[] | null>((resolve) => {
		const finish = (numbers: number[] | null): void => {
			clearTimeout(timer);
			pendingQuestions.delete(requestId);
			resolve(numbers);
		};
		// An unanswered question must not hold a job open forever; cancelling is the safe default.
		const timer = setTimeout(() => finish(null), 15 * 60 * 1000);
		pendingQuestions.set(requestId, finish);
	});
}
/** Refreshes the scheduler started. Everything else came from the user, and always notifies. */
const scheduledRefreshes = new Set<string>();
/** Jobs from before this instant belong to an earlier session and stay out of the jobs list. */
const sessionStartedAt = new Date().toISOString();

app.whenReady().then(main, (cause: unknown) => {
	console.error(cause);
	app.quit();
});

async function main(): Promise<void> {
	// Launched from Finder, the app inherits a bare PATH that holds none of the places a package
	// manager installs to, so `gh`, the agent CLIs and often `git` would simply not be found.
	await inheritLoginShellPath();

	core = await createApp({
		onDataChanged: (repository) => send("data-changed", { repository }),
		confirmTargets: (repository, candidates) => askAboutAssessments(repository, candidates),
	});
	const started = core;

	// A previous run may have been killed with jobs and worktrees still in flight.
	window = createMainWindow();

	started.jobs.recoverInterrupted();
	for (const entry of started.config.repositories) {
		if (entry.clone) {
			// One repository at a time: git serialises on its own lock anyway.
			// oxlint-disable-next-line no-await-in-loop
			await started.worktrees
				.prunePullHeadWorktrees({ repository: entry.name, clone: entry.clone })
				.catch((cause: unknown) => console.warn("Could not prune worktrees:", cause));
		}
	}

	const handlers = createHandlers(started, {
		openExternal: (url) => shell.openExternal(url),
		writeClipboard: (text) => clipboard.writeText(text),
		chooseFolder: async () => {
			const result = await dialog.showOpenDialog({
				title: "Choose the local clone",
				properties: ["openDirectory"],
			});
			return result.filePaths[0] ?? null;
		},
		readLaunchAtLogin: () => app.getLoginItemSettings().openAtLogin,
		writeLaunchAtLogin: (enabled) => {
			app.setLoginItemSettings({ openAtLogin: enabled });
		},
		answerAssessments: (requestId, numbers) => {
			pendingQuestions.get(requestId)?.(numbers);
		},
		writeAppearance: (mode) => {
			nativeTheme.themeSource = mode;
		},
		dataChanged: (repository) => {
			send("data-changed", { repository });
		},
		sessionStartedAt,
	});
	registerIpc(handlers);

	const scheduler = createScheduler({
		config: () => started.config,
		lastRefreshAt: () =>
			started.config.repositories
				.map((entry) => started.store.refreshes.latest(entry.name)?.finishedAt ?? null)
				.filter((value): value is string => value !== null)
				.toSorted()
				.at(-1) ?? null,
		run: async () => {
			// Scheduled refreshes go one repository at a time, as the design says.
			for (const entry of started.config.repositories) {
				try {
					const job = started.startRefresh(entry.name);
					scheduledRefreshes.add(job.id);
					// oxlint-disable-next-line no-await-in-loop
					await started.jobs.wait(job.id);
				} catch (cause) {
					console.warn(cause);
				}
			}
		},
		onError: (cause) => console.warn("Scheduled refresh failed:", cause),
	});
	scheduler.start();
	powerMonitor.on("resume", () => scheduler.wake());

	started.jobs.onChange((job) => {
		send("job-changed", job);
		if (!isFinished(job)) {
			return;
		}
		send("data-changed", { repository: job.repository });

		const showRepository = (): void => window?.showRepository(job.repository);
		if (job.kind === "refresh") {
			const record = started.store.refreshes.latest(job.repository);
			if (record) {
				notify(
					refreshNotification(record, { manual: !scheduledRefreshes.delete(job.id) }),
					showRepository,
				);
			}
			// Whoever refreshed, the next scheduled one is an interval from now.
			scheduler.reschedule();
		} else {
			notify(assessmentNotification(job), showRepository);
		}
	});

	const watcher = await watchConfig({
		onChange: async (loaded) => {
			await started.reloadConfig();
			send("config-changed", loaded.config);
			scheduler.reschedule();
		},
		onError: (cause) => console.warn("The config file could not be read:", cause.message),
	});

	app.on("second-instance", () => window?.show());
	// Clicking the dock icon brings the window back after it has been closed.
	app.on("activate", () => window?.show());
	app.on("before-quit", () => {
		quitting = true;
		window?.allowClose();
	});
	app.on("will-quit", (event) => {
		if (quitting) {
			event.preventDefault();
			quitting = false;
			void shutdown(watcher.close, scheduler.stop);
		}
	});
	// Closing the window leaves the app running, as a Mac app does; Quit ends it.
	app.on("window-all-closed", () => undefined);

	window.show();
}

async function shutdown(
	closeWatcher: () => Promise<void>,
	stopScheduler: () => void,
): Promise<void> {
	stopScheduler();
	await closeWatcher();
	await core?.close();
	app.exit(0);
}

function isFinished(job: Job): boolean {
	return job.state === "completed" || job.state === "failed" || job.state === "aborted";
}
