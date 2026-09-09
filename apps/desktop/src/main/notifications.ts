import { Notification } from "electron";
import type { Refresh } from "@proctologist/core";

export interface NotificationOptions {
	/** A refresh the user asked for always notifies; a scheduled one only when something changed. */
	manual: boolean;
	onClick: (repository: string) => void;
}

/** Returns what the notification would say, or null when there is nothing worth saying. */
export function refreshNotification(
	refresh: Refresh,
	manual: boolean,
): { title: string; body: string } | null {
	const { counts } = refresh;
	const changed = counts.added + counts.reassessed + counts.closed > 0;

	if (!manual && !changed) {
		return null;
	}

	if (refresh.outcome === "failed") {
		return {
			title: `${refresh.repository}: refresh failed`,
			body: refresh.error ?? "Something went wrong.",
		};
	}

	const parts = [
		counts.added > 0 ? `${String(counts.added)} new` : null,
		counts.reassessed > 0 ? `${String(counts.reassessed)} re-assessed` : null,
		counts.closed > 0 ? `${String(counts.closed)} closed` : null,
		counts.unassessed > 0 ? `${String(counts.unassessed)} unassessed` : null,
	].filter((part): part is string => part !== null);

	return {
		title:
			refresh.outcome === "aborted"
				? `${refresh.repository}: refresh stopped`
				: `${refresh.repository}: ${String(counts.fetched)} open pull requests`,
		body: parts.length > 0 ? parts.join(", ") : "Nothing changed.",
	};
}

export function notifyRefresh(refresh: Refresh, options: NotificationOptions): void {
	const content = refreshNotification(refresh, options.manual);
	if (!content || !Notification.isSupported()) {
		return;
	}

	const notification = new Notification({ title: content.title, body: content.body });
	notification.on("click", () => options.onClick(refresh.repository));
	notification.show();
}
