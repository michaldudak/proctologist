import { Notification } from "electron";
import type { Job, Refresh } from "@proctologist/core";

export interface RefreshNotificationOptions {
	/** A refresh the user asked for always notifies; a scheduled one only when something changed. */
	manual: boolean;
}

interface Content {
	title: string;
	body: string;
}

/** What the notification for a finished refresh would say, or null when there is nothing worth saying. */
export function refreshNotification(
	refresh: Refresh,
	options: RefreshNotificationOptions,
): Content | null {
	const { counts } = refresh;
	if (!options.manual && counts.added + counts.closed === 0) {
		return null;
	}

	if (refresh.outcome === "failed") {
		return {
			title: `${refresh.repository}: refresh failed`,
			body: refresh.error ?? "Something went wrong.",
		};
	}
	if (refresh.outcome === "aborted") {
		return { title: `${refresh.repository}: refresh stopped`, body: "Nothing changed." };
	}

	const parts = [
		counts.added > 0 ? `${String(counts.added)} new` : null,
		counts.closed > 0 ? `${String(counts.closed)} closed` : null,
		counts.due > 0 ? `${String(counts.due)} to assess` : null,
	].filter((part): part is string => part !== null);

	return {
		title: `${refresh.repository}: ${String(counts.fetched)} open pull requests`,
		body: parts.length > 0 ? parts.join(", ") : "Nothing changed.",
	};
}

/**
 * What the notification for a finished batch of assessments would say. One pull request assessed
 * from the side panel is not worth one; the user is looking at the row already.
 */
export function assessmentNotification(job: Job): Content | null {
	if (job.kind !== "assessment" || job.number !== null) {
		return null;
	}
	if (job.state === "failed") {
		return {
			title: `${job.repository}: assessment failed`,
			body: job.error ?? "Something went wrong.",
		};
	}

	const progress = job.progress;
	const failed = progress?.failed ?? 0;
	const assessed = progress ? progress.done - failed : 0;
	const parts = [
		assessed > 0 ? `${String(assessed)} assessed` : null,
		failed > 0 ? `${String(failed)} unassessed` : null,
		job.state === "aborted" && progress
			? `${String(progress.total - progress.done)} skipped`
			: null,
	].filter((part): part is string => part !== null);

	return {
		title: `${job.repository}: assessment ${job.state === "aborted" ? "stopped" : "finished"}`,
		body: parts.length > 0 ? parts.join(", ") : "Nothing was assessed.",
	};
}

export function notify(content: Content | null, onClick: () => void): void {
	if (!content || !Notification.isSupported()) {
		return;
	}
	const notification = new Notification({ title: content.title, body: content.body });
	notification.on("click", onClick);
	notification.show();
}
