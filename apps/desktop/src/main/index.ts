import { app, clipboard, dialog, powerMonitor, shell } from "electron";
import { createApp, type App as Core, type Job } from "@proctologist/core";
import { watchConfig } from "@proctologist/core";
import { createHandlers } from "./handlers.js";
import { registerIpc } from "./ipc.js";
import { notifyRefresh } from "./notifications.js";
import { createScheduler } from "./scheduler.js";
import { createTray, type TrayController } from "./tray.js";
import { createMainWindow, type MainWindow } from "./window.js";
import { CHANNEL_PREFIX } from "../shared/ipc.js";

// A second copy would fight over the database and the refresh lock.
if (!app.requestSingleInstanceLock()) {
	app.quit();
}

let core: Core | undefined;
let window: MainWindow | undefined;
let tray: TrayController | undefined;
let quitting = false;
/** Repositories whose refresh the user started from this window, so it always notifies. */
const manualRefreshes = new Set<string>();
let unviewed = false;

app.whenReady().then(main, (cause: unknown) => {
	console.error(cause);
	app.quit();
});

async function main(): Promise<void> {
	// The dock icon would be misleading for a menu-bar app that hides its window.
	app.dock?.hide();

	core = await createApp();
	const started = core;

	// A previous run may have been killed with jobs and worktrees still in flight.
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

	window = createMainWindow();
	const send = (channel: string, payload: unknown): void => {
		window?.send(`${CHANNEL_PREFIX}${channel}`, payload);
	};

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
		dataChanged: (repository) => {
			send("data-changed", { repository });
			refreshTray();
		},
	});
	registerIpc(handlers);

	tray = createTray({
		refresh: (repository) => {
			manualRefreshes.add(repository);
			try {
				started.startRefresh(repository);
			} catch (cause) {
				console.warn(cause);
			}
			refreshTray();
		},
		refreshAll: () => {
			void handlers.refreshAll().then(refreshTray);
		},
		abort: (id) => {
			started.jobs.abort(id);
		},
		open: () => window?.show(),
		quit: () => {
			quitting = true;
			app.quit();
		},
	});
	refreshTray();

	started.jobs.onChange((job) => {
		send("job-changed", job);
		if (job.kind === "refresh" && isFinished(job)) {
			const record = started.store.refreshes.latest(job.repository);
			if (record) {
				unviewed = unviewed || record.counts.added + record.counts.reassessed > 0;
				notifyRefresh(record, {
					manual: manualRefreshes.delete(job.repository),
					onClick: (repository) => window?.showRepository(repository),
				});
			}
			send("data-changed", { repository: job.repository });
		}
		refreshTray();
	});

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

	const watcher = await watchConfig({
		onChange: async (loaded) => {
			await started.reloadConfig();
			send("config-changed", loaded.config);
			scheduler.reschedule();
			refreshTray();
		},
		onError: (cause) => console.warn("The config file could not be read:", cause.message),
	});

	app.on("second-instance", () => window?.show());
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
	// Hiding the window must not end the app: it lives in the menu bar.
	app.on("window-all-closed", () => undefined);
}

async function shutdown(
	closeWatcher: () => Promise<void>,
	stopScheduler: () => void,
): Promise<void> {
	stopScheduler();
	tray?.destroy();
	await closeWatcher();
	await core?.close();
	app.exit(0);
}

function refreshTray(): void {
	if (!core || !tray) {
		return;
	}
	tray.update({
		repositories: core.config.repositories.map((entry) => entry.name),
		activeJobs: core.jobs.list({ active: true }),
		unviewed: unviewed && !(window?.isVisible() ?? false),
	});
}

function isFinished(job: Job): boolean {
	return job.state === "completed" || job.state === "failed" || job.state === "aborted";
}
