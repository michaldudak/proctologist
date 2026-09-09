import { parseConfig, type Config } from "@proctologist/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createScheduler,
	missedRun,
	nextOccurrence,
	previousOccurrence,
	type Scheduler,
} from "./scheduler.js";

const local = (text: string): Date => new Date(text);

describe("nextOccurrence", () => {
	it("finds today's time when it is still ahead", () => {
		expect(nextOccurrence("08:00", local("2026-09-09T06:30:00"))).toEqual(
			local("2026-09-09T08:00:00"),
		);
	});

	it("rolls over to tomorrow once the time has passed", () => {
		expect(nextOccurrence("08:00", local("2026-09-09T09:30:00"))).toEqual(
			local("2026-09-10T08:00:00"),
		);
	});

	it("rolls over when the time is exactly now, so a run never fires twice", () => {
		expect(nextOccurrence("08:00", local("2026-09-09T08:00:00"))).toEqual(
			local("2026-09-10T08:00:00"),
		);
	});
});

describe("previousOccurrence", () => {
	it("looks back to yesterday when today's time has not come", () => {
		expect(previousOccurrence("08:00", local("2026-09-09T06:30:00"))).toEqual(
			local("2026-09-08T08:00:00"),
		);
	});
});

describe("missedRun", () => {
	it("is true when nothing has been refreshed since the scheduled time", () => {
		expect(missedRun("08:00", local("2026-09-09T10:00:00"), "2026-09-08T09:00:00.000Z")).toBe(true);
	});

	it("is false when a refresh happened after the scheduled time", () => {
		expect(
			missedRun("08:00", local("2026-09-09T10:00:00"), local("2026-09-09T08:30:00").toISOString()),
		).toBe(false);
	});

	it("is true when nothing has ever been refreshed", () => {
		expect(missedRun("08:00", local("2026-09-09T10:00:00"), null)).toBe(true);
	});
});

describe("createScheduler", () => {
	let config: Config;
	let clock: Date;
	let timers: { fn: () => void; ms: number }[];
	let run: ReturnType<typeof vi.fn<() => Promise<void>>>;
	let lastRefreshAt: string | null;

	function build(): Scheduler {
		return createScheduler({
			config: () => config,
			run,
			lastRefreshAt: () => lastRefreshAt,
			now: () => clock,
			setTimer: (fn, ms) => {
				timers.push({ fn, ms });
				return timers.length - 1;
			},
			clearTimer: (handle) => {
				timers[handle as number] = { fn: () => undefined, ms: -1 };
			},
		});
	}

	beforeEach(() => {
		config = parseConfig(`schedule = { enabled = true, time = "08:00" }`);
		clock = local("2026-09-09T06:00:00");
		timers = [];
		run = vi.fn<() => Promise<void>>().mockResolvedValue();
		lastRefreshAt = local("2026-09-09T05:00:00").toISOString();
	});

	it("arms a timer for the next scheduled time and refreshes nothing on start", () => {
		const scheduler = build();
		scheduler.start();

		expect(run).not.toHaveBeenCalled();
		expect(scheduler.nextRun()).toEqual(local("2026-09-09T08:00:00"));
		expect(timers[0]?.ms).toBe(2 * 60 * 60 * 1000);
	});

	it("does nothing at all when the schedule is off", () => {
		config = parseConfig("");
		const scheduler = build();
		scheduler.start();

		expect(scheduler.nextRun()).toBeNull();
		expect(timers).toHaveLength(0);
	});

	it("refreshes when the timer fires and arms the next day", async () => {
		const scheduler = build();
		scheduler.start();

		clock = local("2026-09-09T08:00:00");
		timers[0]?.fn();
		await vi.waitFor(() => expect(scheduler.nextRun()).toEqual(local("2026-09-10T08:00:00")));

		expect(run).toHaveBeenCalledOnce();
	});

	it("catches up on waking when the scheduled run was slept through", () => {
		const scheduler = build();
		scheduler.start();

		clock = local("2026-09-09T10:00:00");
		scheduler.wake();

		expect(run).toHaveBeenCalledOnce();
	});

	it("only re-arms on waking when nothing was missed", () => {
		lastRefreshAt = local("2026-09-09T08:30:00").toISOString();
		const scheduler = build();
		scheduler.start();

		clock = local("2026-09-09T10:00:00");
		scheduler.wake();

		expect(run).not.toHaveBeenCalled();
		expect(scheduler.nextRun()).toEqual(local("2026-09-10T08:00:00"));
	});

	it("ignores a wake-up when the schedule is off", () => {
		config = parseConfig("");
		const scheduler = build();

		scheduler.wake();

		expect(run).not.toHaveBeenCalled();
	});

	it("does not start a second refresh while one is running", () => {
		run = vi.fn<() => Promise<void>>().mockReturnValue(new Promise(() => undefined));
		const scheduler = build();
		scheduler.start();

		timers[0]?.fn();
		scheduler.wake();
		clock = local("2026-09-09T10:00:00");
		scheduler.wake();

		expect(run).toHaveBeenCalledOnce();
	});

	it("reports a failed run instead of throwing", async () => {
		const onError = vi.fn();
		const scheduler = createScheduler({
			config: () => config,
			run: () => Promise.reject(new Error("GitHub is down")),
			lastRefreshAt: () => lastRefreshAt,
			now: () => clock,
			setTimer: (fn, ms) => {
				timers.push({ fn, ms });
				return timers.length - 1;
			},
			clearTimer: () => undefined,
			onError,
		});
		scheduler.start();

		timers[0]?.fn();

		await vi.waitFor(() => expect(onError).toHaveBeenCalled());
	});

	it("stops re-arming once stopped", () => {
		const scheduler = build();
		scheduler.start();
		scheduler.stop();

		expect(scheduler.nextRun()).toBeNull();
	});

	it("re-arms when the configured time changes", () => {
		const scheduler = build();
		scheduler.start();

		config = parseConfig(`schedule = { enabled = true, time = "07:00" }`);
		scheduler.reschedule();

		expect(scheduler.nextRun()).toEqual(local("2026-09-09T07:00:00"));
	});
});
