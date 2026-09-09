import type { Config } from "@proctologist/core";

export interface SchedulerOptions {
	/** Read afresh so an edit to the config file reschedules without a restart. */
	config: () => Config;
	/** Refreshes every tracked repository, in sequence. */
	run: () => Promise<void>;
	/** When the last refresh of any repository finished, used to spot a run the machine slept through. */
	lastRefreshAt: () => string | null;
	now?: () => Date;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	onError?: (error: unknown) => void;
}

export interface Scheduler {
	/** Arms the timer. Never refreshes straight away: launching is not a reason to refresh. */
	start: () => void;
	stop: () => void;
	/** Re-reads the config and re-arms. */
	reschedule: () => void;
	/** Call when the machine wakes: catches up on a run that was missed while it slept. */
	wake: () => void;
	/** When the next refresh will happen, or null when the schedule is off. */
	nextRun: () => Date | null;
}

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

	function arm(): void {
		if (handle !== undefined) {
			clearTimer(handle);
			handle = undefined;
		}
		const schedule = options.config().schedule;
		if (!schedule.enabled) {
			next = null;
			return;
		}
		next = nextOccurrence(schedule.time, now());
		// Timers longer than the 32-bit limit fire immediately, so a distant run is re-armed later.
		const delay = Math.min(next.getTime() - now().getTime(), 2_147_483_647);
		handle = setTimer(fire, Math.max(delay, 0));
	}

	return {
		start: arm,
		reschedule: arm,
		stop: () => {
			if (handle !== undefined) {
				clearTimer(handle);
				handle = undefined;
			}
			next = null;
		},
		wake: () => {
			const schedule = options.config().schedule;
			if (schedule.enabled && missedRun(schedule.time, now(), options.lastRefreshAt())) {
				fire();
				return;
			}
			arm();
		},
		nextRun: () => next,
	};
}

/** The next time of day `time` falls after `from`, in the machine's own time zone. */
export function nextOccurrence(time: string, from: Date): Date {
	const [hours, minutes] = parseTime(time);
	const next = new Date(from);
	next.setHours(hours, minutes, 0, 0);
	if (next.getTime() <= from.getTime()) {
		next.setDate(next.getDate() + 1);
	}
	return next;
}

/** The most recent time `time` fell at or before `from`. */
export function previousOccurrence(time: string, from: Date): Date {
	const [hours, minutes] = parseTime(time);
	const previous = new Date(from);
	previous.setHours(hours, minutes, 0, 0);
	if (previous.getTime() > from.getTime()) {
		previous.setDate(previous.getDate() - 1);
	}
	return previous;
}

/** True when the scheduled run has come and gone without a refresh, for example during sleep. */
export function missedRun(time: string, from: Date, lastRefreshAt: string | null): boolean {
	const due = previousOccurrence(time, from);
	return lastRefreshAt === null || Date.parse(lastRefreshAt) < due.getTime();
}

function parseTime(time: string): [number, number] {
	const [hours, minutes] = time.split(":").map(Number);
	return [hours ?? 0, minutes ?? 0];
}
