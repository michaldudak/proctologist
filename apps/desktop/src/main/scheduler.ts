import type { Config } from "@proctologist/core";

export interface SchedulerOptions {
	/** Read afresh so an edit to the config file reschedules without a restart. */
	config: () => Config;
	/** Refreshes every tracked repository, in sequence. */
	run: () => Promise<void>;
	/** When the last refresh of any repository finished, scheduled or not. */
	lastRefreshAt: () => string | null;
	now?: () => Date;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	onError?: (error: unknown) => void;
}

export interface Scheduler {
	/** Arms the timer. Runs soon when the last refresh is older than the interval. */
	start: () => void;
	stop: () => void;
	/** Re-reads the config and the last refresh time, and re-arms. */
	reschedule: () => void;
	/** Call when the machine wakes: a refresh slept through runs once the network has settled. */
	wake: () => void;
	/** When the next refresh will happen, or null when the schedule is off. */
	nextRun: () => Date | null;
}

/** How long an overdue refresh waits before running, so the network is back after a wake. */
export const CATCH_UP_DELAY_MS = 15_000;

/** Timers longer than the 32-bit limit fire immediately, so a distant run is re-armed later. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * Fetches every tracked repository once per interval, counted from the last refresh of any of them,
 * whoever started it. Assessing nothing, a run is cheap enough to happen whenever it is due.
 */
export function createScheduler(options: SchedulerOptions): Scheduler {
	const now = options.now ?? ((): Date => new Date());
	const setTimer =
		options.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
	const clearTimer =
		options.clearTimer ??
		((handle: unknown): void => {
			clearTimeout(handle as NodeJS.Timeout);
		});

	let handle: unknown;
	let next: Date | null = null;
	let running = false;

	const fire = (): void => {
		if (running) {
			return;
		}
		running = true;
		options
			.run()
			.catch((cause: unknown) => options.onError?.(cause))
			.finally(() => {
				running = false;
				arm();
			});
	};

	function clear(): void {
		if (handle !== undefined) {
			clearTimer(handle);
			handle = undefined;
		}
	}

	function arm(): void {
		clear();
		const config = options.config();
		if (!config.schedule.enabled || config.repositories.length === 0) {
			next = null;
			return;
		}
		next = nextRun(config.schedule.intervalMinutes, now(), options.lastRefreshAt());
		handle = setTimer(fire, Math.min(next.getTime() - now().getTime(), MAX_TIMER_MS));
	}

	return {
		start: arm,
		reschedule: arm,
		wake: arm,
		stop: () => {
			clear();
			next = null;
		},
		nextRun: () => next,
	};
}

/**
 * One interval after the last refresh, or a short grace period from now when that has passed or
 * nothing has been refreshed yet.
 */
export function nextRun(intervalMinutes: number, from: Date, lastRefreshAt: string | null): Date {
	const soonest = from.getTime() + CATCH_UP_DELAY_MS;
	if (lastRefreshAt === null) {
		return new Date(soonest);
	}
	return new Date(Math.max(Date.parse(lastRefreshAt) + intervalMinutes * 60_000, soonest));
}
