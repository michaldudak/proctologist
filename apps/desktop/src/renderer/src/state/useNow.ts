import { useSyncExternalStore } from "react";

const TICK_MS = 60_000;

let current = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function tick(): void {
	current = Date.now();
	for (const listener of listeners) {
		listener();
	}
}

function subscribe(listener: () => void): () => void {
	if (listeners.size === 0) {
		// The clock only runs while something is reading it, and picks up where it left off rather
		// than serving a snapshot from before the last reader went away.
		current = Date.now();
		timer = setInterval(tick, TICK_MS);
	}
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) {
			clearInterval(timer);
			timer = undefined;
		}
	};
}

function read(): number {
	return current;
}

/**
 * The time, to the minute, shared by everything that shows a relative age: one interval for the
 * whole window rather than one per cell, and every "3m" on screen moving to "4m" together.
 */
export function useNow(): number {
	return useSyncExternalStore(subscribe, read);
}
