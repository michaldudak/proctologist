import type { ErrorEntry } from "../../../shared/ipc.js";
import { words } from "./jobs.js";

/** How many numbers a title names before it counts the rest. */
const NAMED = 3;

/** "#12", "#12 and #15", "#12, #15 and #18", "#12, #15 and 6 more". */
export function listNumbers(numbers: number[]): string {
	const named = numbers.map((number) => `#${String(number)}`);
	if (named.length <= NAMED) {
		return named.length <= 1
			? (named[0] ?? "")
			: `${named.slice(0, -1).join(", ")} and ${named.at(-1) ?? ""}`;
	}
	const shown = named.slice(0, NAMED - 1);
	return `${shown.join(", ")} and ${String(named.length - shown.length)} more`;
}

/** What was being done when it went wrong, in the words the jobs panel uses for the same work. */
export function errorTitle(entry: ErrorEntry): string {
	const { verb, nouns } = words(entry.itemKind);
	const items = entry.numbers.length === 0 ? nouns : listNumbers(entry.numbers);
	switch (entry.source) {
		case "command": {
			return entry.action ?? "A command";
		}
		case "refresh": {
			return "Refresh";
		}
		case "assessment": {
			return `${verb} ${items}`;
		}
		case "thorough_assessment": {
			return `${verb} ${items} thoroughly`;
		}
		case "review_draft": {
			return `Draft a review of ${items}`;
		}
		default: {
			return entry.source;
		}
	}
}

/**
 * What a failed command said, without what Electron wraps it in on the way across: the channel
 * name means nothing to the user, and the error's class name even less.
 */
export function commandMessage(cause: unknown): string {
	const message = cause instanceof Error ? cause.message : String(cause);
	return message.replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, "");
}

/** The whole entry as text, for pasting into an issue or a chat. */
export function errorText(entry: ErrorEntry): string {
	return [
		entry.repository === null ? errorTitle(entry) : `${errorTitle(entry)} · ${entry.repository}`,
		entry.message,
		entry.logPath === null ? null : `Log: ${entry.logPath}`,
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}

/**
 * How many are newer than the newest one the user has looked at. The list is newest first; an id
 * that is no longer in it, because the log was emptied or that entry aged out, means all of them.
 */
export function unseenCount(errors: ErrorEntry[], lastSeenId: string | null): number {
	const index = lastSeenId === null ? -1 : errors.findIndex((entry) => entry.id === lastSeenId);
	return index === -1 ? errors.length : index;
}
