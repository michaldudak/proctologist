import { Notification } from "electron";
import type { Job, Refresh } from "@proctologist/core";

export interface NotificationOptions {
	/** A refresh the user asked for always notifies; a scheduled one only when something changed. */
	manual: boolean;
	/** The assessment job the refresh queued, once it has finished; left out when it queued none. */
	assessment?: Job | undefined;
}

/**
 * What the notification would say, or null when there is nothing worth saying. A refresh and the
 * assessment it queued are one piece of work to the user, so they get one notification, sent when
 * the later of the two is done.
 */
export function refreshNotification(
	refresh: Refresh,
	options: NotificationOptions,
): { title: string; body: string } | null {
	const { counts } = refresh;
	const { assessment } = options;
	const progress = assessment?.progress;
	const failed = progress?.failed ?? 0;
	const assessed = progress ? progress.done - failed : 0;
	const changed = counts.added + counts.closed + assessed > 0;

	if (!options.manual && !changed) {
		return null;
	}

	if (refresh.outcome === "failed") {
		return {
			title: `${refresh.repository}: refresh failed`,
			body: refresh.error ?? "Something went wrong.",
		};
	}
	if (assessment?.state === "failed") {
		return {
			title: `${refresh.repository}: assessment failed`,
			body: assessment.error ?? "Something went wrong.",
		};
	}

	const parts = [
		counts.added > 0 ? `${String(counts.added)} new` : null,
		counts.closed > 0 ? `${String(counts.closed)} closed` : null,
		assessed > 0 ? `${String(assessed)} assessed` : null,
		failed > 0 ? `${String(failed)} unassessed` : null,
		assessment?.state === "aborted" && progress
			? `${String(progress.total - progress.done)} skipped`
			: null,
	].filter((part): part is string => part !== null);

	const stopped = refresh.outcome === "aborted" || assessment?.state === "aborted";
	return {
		title: stopped
			? `${refresh.repository}: ${refresh.outcome === "aborted" ? "refresh" : "assessment"} stopped`
			: `${refresh.repository}: ${String(counts.fetched)} open pull requests`,
		body: parts.length > 0 ? parts.join(", ") : "Nothing changed.",
	};
}

export function notifyRefresh(
	refresh: Refresh,
	options: NotificationOptions & { onClick: (repository: string) => void },
): void {
	const content = refreshNotification(refresh, options);
	if (!content || !Notification.isSupported()) {
		return;
	}

	const notification = new Notification({ title: content.title, body: content.body });
	notification.on("click", () => options.onClick(refresh.repository));
	notification.show();
}
