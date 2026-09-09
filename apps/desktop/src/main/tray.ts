import { Menu, Tray, type MenuItemConstructorOptions } from "electron";
import type { Job } from "@proctologist/core";
import { trayIcon } from "./icon.js";

export interface TrayState {
	repositories: string[];
	/** Queued or running jobs, newest last. */
	activeJobs: Job[];
	/** True when assessments changed since the user last looked. */
	unviewed: boolean;
}

export interface TrayActions {
	refresh: (repository: string) => void;
	refreshAll: () => void;
	abort: (id: string) => void;
	open: () => void;
	quit: () => void;
}

export interface TrayController {
	update: (state: TrayState) => void;
	destroy: () => void;
}

export function createTray(actions: TrayActions): TrayController {
	const tray = new Tray(trayIcon());
	tray.setToolTip("PRoctologist");
	tray.on("click", () => {
		actions.open();
	});

	return {
		update: (state) => {
			tray.setImage(trayIcon({ unviewed: state.unviewed }));
			// Progress goes in the tray title: a 16 pixel icon has nowhere to put a number.
			tray.setTitle(progressTitle(state.activeJobs));
			tray.setContextMenu(Menu.buildFromTemplate(buildMenu(state, actions)));
		},
		destroy: () => {
			tray.destroy();
		},
	};
}

export function progressTitle(activeJobs: Job[]): string {
	const running = activeJobs.filter((job) => job.state === "running");
	if (running.length === 0) {
		return "";
	}
	const withProgress = running.find((job) => job.progress);
	if (!withProgress?.progress) {
		return "…";
	}
	return `${String(withProgress.progress.done)}/${String(withProgress.progress.total)}`;
}

export function buildMenu(state: TrayState, actions: TrayActions): MenuItemConstructorOptions[] {
	const items: MenuItemConstructorOptions[] = [];

	if (state.repositories.length === 0) {
		items.push({ label: "No repositories tracked", enabled: false });
	} else {
		for (const repository of state.repositories) {
			items.push({
				label: `Refresh ${repository}`,
				click: () => actions.refresh(repository),
			});
		}
		if (state.repositories.length > 1) {
			items.push({ label: "Refresh all", click: () => actions.refreshAll() });
		}
	}

	if (state.activeJobs.length > 0) {
		items.push({ type: "separator" });
		for (const job of state.activeJobs) {
			items.push({
				label: `Stop ${describe(job)}`,
				click: () => actions.abort(job.id),
			});
		}
	}

	items.push(
		{ type: "separator" },
		{ label: "Open PRoctologist", click: () => actions.open() },
		{ label: "Quit", click: () => actions.quit() },
	);

	return items;
}

function describe(job: Job): string {
	const target = job.number === null ? job.repository : `${job.repository}#${String(job.number)}`;
	switch (job.kind) {
		case "refresh": {
			return `refreshing ${target}`;
		}
		case "thorough_assessment": {
			return `assessing ${target}`;
		}
		default: {
			return `reviewing ${target}`;
		}
	}
}
