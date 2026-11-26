import type { ItemKind, JobKind } from "../store/types.js";

/**
 * What was going on when it went wrong: one of the job kinds, or `command` for something the user
 * asked the window to do that failed before any job began.
 */
export type ErrorSource = JobKind | "command";

/**
 * One thing that went wrong this session, kept with enough to act on it: the full message, what it
 * was about, and the agent's own log when an agent run was behind it.
 */
export interface ErrorEntry {
	id: string;
	at: string;
	source: ErrorSource;
	repository: string | null;
	/** Which kind the items are, when the error is about items. */
	itemKind: ItemKind | null;
	/** The items it held up, in the order they were asked for; empty for a whole repository. */
	numbers: number[];
	/** The whole message, never cut short: the point of keeping it is to read all of it. */
	message: string;
	/** The agent run's log file, for an error an agent run is behind. */
	logPath: string | null;
	/** For a `command`, what the user asked for, since there is no job to describe it by. */
	action: string | null;
}

export interface NewErrorEntry {
	source: ErrorSource;
	repository?: string | null | undefined;
	itemKind?: ItemKind | null | undefined;
	numbers?: number[] | undefined;
	message: string;
	logPath?: string | null | undefined;
	action?: string | null | undefined;
}
