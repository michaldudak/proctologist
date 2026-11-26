import { randomUUID } from "node:crypto";
import type { ErrorEntry, NewErrorEntry } from "./types.js";

export interface ErrorLogOptions {
	/** How many are kept; the oldest go first. */
	limit?: number;
	now?: () => string;
}

/**
 * The errors of this session, newest first. Kept in memory: they explain what just went wrong,
 * and what went wrong before a restart is in the jobs, the assessments and the agent logs already.
 */
export interface ErrorLog {
	add: (entry: NewErrorEntry) => ErrorEntry;
	list: () => ErrorEntry[];
	clear: () => void;
	/** Told of every error as it is added; returns a function that stops listening. */
	onAdd: (listener: (entry: ErrorEntry) => void) => () => void;
	/** Told when the log is emptied, so a window holding a copy can empty its own. */
	onClear: (listener: () => void) => () => void;
}

export function createErrorLog(options: ErrorLogOptions = {}): ErrorLog {
	const limit = options.limit ?? 200;
	const now = options.now ?? ((): string => new Date().toISOString());
	let entries: ErrorEntry[] = [];
	const added = new Set<(entry: ErrorEntry) => void>();
	const cleared = new Set<() => void>();

	return {
		add: (input) => {
			const entry: ErrorEntry = {
				id: randomUUID(),
				at: now(),
				source: input.source,
				repository: input.repository ?? null,
				itemKind: input.itemKind ?? null,
				numbers: input.numbers ?? [],
				message: input.message,
				logPath: input.logPath ?? null,
				action: input.action ?? null,
			};
			entries = [entry, ...entries].slice(0, limit);
			for (const listener of added) {
				listener(entry);
			}
			return entry;
		},
		list: () => [...entries],
		clear: () => {
			entries = [];
			for (const listener of cleared) {
				listener();
			}
		},
		onAdd: (listener) => {
			added.add(listener);
			return () => added.delete(listener);
		},
		onClear: (listener) => {
			cleared.add(listener);
			return () => cleared.delete(listener);
		},
	};
}
