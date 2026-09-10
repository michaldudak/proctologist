import { parseConfig, type Config } from "@proctologist/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CATCH_UP_DELAY_MS, createScheduler, nextRun, type Scheduler } from "./scheduler.js";

const at = (text: string): Date => new Date(text);
const MINUTE = 60_000;
const TRACKED = `[[repositories]]\nname = "owner/thing"\n`;

describe("nextRun", () => {
	it("is one interval after the last refresh", () => {
		expect(nextRun(60, at("2026-09-09T06:30:00Z"), "2026-09-09T06:00:00.000Z")).toEqual(
			at("2026-09-09T07:00:00Z"),
		);
	});

	it("is a moment from now when the interval has already passed", () => {
		expect(nextRun(60, at("2026-09-09T09:30:00Z"), "2026-09-09T06:00:00.000Z")).toEqual(
			new Date(at("2026-09-09T09:30:00Z").getTime() + CATCH_UP_DELAY_MS),
		);
	});

	it("is a moment from now when nothing has ever been refreshed", () => {
		expect(nextRun(60, at("2026-09-09T09:30:00Z"), null)).toEqual(
			new Date(at("2026-09-09T09:30:00Z").getTime() + CATCH_UP_DELAY_MS),
		);
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
		config = parseConfig(`schedule = { enabled = true, interval_minutes = 60 }\n${TRACKED}`);
		clock = at("2026-09-09T06:30:00Z");
		timers = [];
		run = vi.fn<() => Promise<void>>().mockResolvedValue();
		lastRefreshAt = at("2026-09-09T06:00:00Z").toISOString();
	});

	it("arms a timer for one interval after the last refresh, and runs nothing yet", () => {
		const scheduler = build();
		scheduler.start();

		expect(run).not.toHaveBeenCalled();
		expect(scheduler.nextRun()).toEqual(at("2026-09-09T07:00:00Z"));
		expect(timers[0]?.ms).toBe(30 * MINUTE);
	});

	it("runs soon after starting when the last refresh is older than the interval", () => {
		lastRefreshAt = at("2026-09-09T02:00:00Z").toISOString();
		const scheduler = build();
		scheduler.start();

		expect(timers[0]?.ms).toBe(CATCH_UP_DELAY_MS);
	});

	it("does nothing at all when the schedule is off", () => {
		config = parseConfig(`schedule = { enabled = false }\n${TRACKED}`);
		const scheduler = build();
		scheduler.start();

		expect(scheduler.nextRun()).toBeNull();
		expect(timers).toHaveLength(0);
	});

	it("does nothing when no repository is tracked", () => {
		config = parseConfig("");
		const scheduler = build();
		scheduler.start();

		expect(scheduler.nextRun()).toBeNull();
		expect(timers).toHaveLength(0);
	});

	it("refreshes when the timer fires and arms the next interval", async () => {
		const scheduler = build();
		scheduler.start();

		clock = at("2026-09-09T07:00:00Z");
		lastRefreshAt = clock.toISOString();
		timers[0]?.fn();
		await vi.waitFor(() => expect(scheduler.nextRun()).toEqual(at("2026-09-09T08:00:00Z")));

		expect(run).toHaveBeenCalledOnce();
	});

	it("pushes the next run out when a refresh happens in the meantime", () => {
		const scheduler = build();
		scheduler.start();

		clock = at("2026-09-09T06:45:00Z");
		lastRefreshAt = clock.toISOString();
		scheduler.reschedule();

		expect(scheduler.nextRun()).toEqual(at("2026-09-09T07:45:00Z"));
		expect(timers[0]?.ms).toBe(-1);
	});

	it("catches up shortly after waking when a run was slept through", () => {
		const scheduler = build();
		scheduler.start();

		clock = at("2026-09-09T10:00:00Z");
		scheduler.wake();

		expect(run).not.toHaveBeenCalled();
		expect(timers.at(-1)?.ms).toBe(CATCH_UP_DELAY_MS);
	});

	it("only re-arms on waking when nothing was missed", () => {
		const scheduler = build();
		scheduler.start();

		clock = at("2026-09-09T06:40:00Z");
		scheduler.wake();

		expect(scheduler.nextRun()).toEqual(at("2026-09-09T07:00:00Z"));
		expect(timers.at(-1)?.ms).toBe(20 * MINUTE);
	});

	it("does not start a second refresh while one is running", () => {
		run = vi.fn<() => Promise<void>>().mockReturnValue(new Promise(() => undefined));
		const scheduler = build();
		scheduler.start();

		timers[0]?.fn();
		clock = at("2026-09-09T10:00:00Z");
		scheduler.wake();
		timers.at(-1)?.fn();

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

	it("re-arms when the interval changes", () => {
		const scheduler = build();
		scheduler.start();

		config = parseConfig(`schedule = { enabled = true, interval_minutes = 15 }\n${TRACKED}`);
		scheduler.reschedule();

		expect(scheduler.nextRun()).toEqual(
			new Date(at("2026-09-09T06:30:00Z").getTime() + CATCH_UP_DELAY_MS),
		);
	});
});
