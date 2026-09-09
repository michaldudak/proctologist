import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openStore, type Store } from "../store/store.js";
import type { Job } from "../store/types.js";
import { createJobRunner, type JobHandler } from "./runner.js";

const REPO = "owner/thing";

let store: Store;

beforeEach(() => {
	store = openStore(":memory:");
});

afterEach(() => {
	store.close();
});

function runner(handlers: Parameters<typeof createJobRunner>[0]["handlers"], concurrency = 2) {
	return createJobRunner({ store, concurrency, handlers });
}

const never: JobHandler = ({ signal }) =>
	new Promise((_resolve, reject) => {
		signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
	});

describe("enqueue", () => {
	it("runs the handler and records the job as completed", async () => {
		const handler = vi.fn<JobHandler>().mockResolvedValue();
		const jobs = runner({ refresh: handler });

		const job = jobs.enqueue({ kind: "refresh", repository: REPO });
		const finished = await jobs.wait(job.id);

		expect(handler).toHaveBeenCalledOnce();
		expect(finished).toMatchObject({ state: "completed", error: null });
		expect(finished.startedAt).not.toBeNull();
		expect(finished.finishedAt).not.toBeNull();
	});

	it("records a failing handler with its message", async () => {
		const jobs = runner({ refresh: () => Promise.reject(new Error("GitHub said no")) });

		const job = jobs.enqueue({ kind: "refresh", repository: REPO });

		expect(await jobs.wait(job.id)).toMatchObject({
			state: "failed",
			error: "GitHub said no",
		});
	});

	it("fails a job of a kind it has no handler for", async () => {
		const jobs = runner({});

		const job = jobs.enqueue({ kind: "refresh", repository: REPO });

		expect(await jobs.wait(job.id)).toMatchObject({ state: "failed" });
	});

	it("refuses a second refresh of the same repository", () => {
		const jobs = runner({ refresh: never });
		jobs.enqueue({ kind: "refresh", repository: REPO });

		expect(() => jobs.enqueue({ kind: "refresh", repository: REPO })).toThrow(/already running/);
	});

	it("keeps the target of a per-pull-request job", async () => {
		const jobs = runner({ review_draft: () => Promise.resolve() });

		const job = jobs.enqueue({ kind: "review_draft", repository: REPO, number: 12 });

		expect(await jobs.wait(job.id)).toMatchObject({ number: 12, itemKind: "pull_request" });
	});
});

describe("progress", () => {
	it("stores progress and tells listeners", async () => {
		const seen: Job[] = [];
		const jobs = runner({
			refresh: ({ setProgress }) => {
				setProgress({ done: 1, total: 3, label: "assessing" });
				return Promise.resolve();
			},
		});
		jobs.onChange((job) => seen.push({ ...job }));

		const job = jobs.enqueue({ kind: "refresh", repository: REPO });
		await jobs.wait(job.id);

		expect(seen.map((entry) => entry.state)).toEqual(["queued", "running", "running", "completed"]);
		expect(seen[2]?.progress).toEqual({ done: 1, total: 3, label: "assessing" });
	});

	it("stops telling a listener that unsubscribed", async () => {
		const listener = vi.fn();
		const jobs = runner({ refresh: () => Promise.resolve() });
		jobs.onChange(listener)();

		await jobs.wait(jobs.enqueue({ kind: "refresh", repository: REPO }).id);

		expect(listener).not.toHaveBeenCalled();
	});
});

describe("the shared Codex cap", () => {
	it("limits concurrent Codex work across every running job", async () => {
		let running = 0;
		let peak = 0;
		const work = async (): Promise<void> => {
			running += 1;
			peak = Math.max(peak, running);
			await new Promise((resolve) => setTimeout(resolve, 5));
			running -= 1;
		};
		const handler: JobHandler = async ({ codexSlot }) => {
			await Promise.all([codexSlot(work), codexSlot(work), codexSlot(work)]);
		};
		const jobs = runner({ refresh: handler, thorough_assessment: handler }, 2);

		const first = jobs.enqueue({ kind: "refresh", repository: REPO });
		const second = jobs.enqueue({ kind: "thorough_assessment", repository: REPO, number: 1 });
		await Promise.all([jobs.wait(first.id), jobs.wait(second.id)]);

		expect(peak).toBe(2);
	});
});

describe("abort", () => {
	it("stops a running job and records it as aborted", async () => {
		const jobs = runner({ refresh: never });
		const job = jobs.enqueue({ kind: "refresh", repository: REPO });

		expect(jobs.abort(job.id)).toBe(true);

		expect(await jobs.wait(job.id)).toMatchObject({ state: "aborted" });
	});

	it("records a job that finished normally after an abort as aborted too", async () => {
		const jobs = runner({
			refresh: ({ signal }) =>
				new Promise((resolve) => {
					signal.addEventListener("abort", () => resolve(), { once: true });
				}),
		});
		const job = jobs.enqueue({ kind: "refresh", repository: REPO });
		jobs.abort(job.id);

		expect(await jobs.wait(job.id)).toMatchObject({ state: "aborted" });
	});

	it("says so when there is nothing to abort", () => {
		expect(runner({}).abort("no-such-job")).toBe(false);
	});

	it("frees the refresh lock once the job has stopped", async () => {
		const jobs = runner({ refresh: never });
		const first = jobs.enqueue({ kind: "refresh", repository: REPO });
		jobs.abort(first.id);
		await jobs.wait(first.id);

		expect(() => jobs.enqueue({ kind: "refresh", repository: REPO })).not.toThrow();
	});
});

describe("recoverInterrupted", () => {
	it("fails jobs a previous process left behind", () => {
		store.jobs.create({ id: "old", kind: "refresh", repository: REPO }, "2026-09-01T00:00:00Z");
		store.jobs.start("old", "2026-09-01T00:00:00Z");
		const jobs = runner({});

		expect(jobs.recoverInterrupted()).toBe(1);
		expect(jobs.get("old")).toMatchObject({ state: "failed" });
	});
});

describe("shutdown", () => {
	it("aborts everything still running", async () => {
		const jobs = runner({ refresh: never, thorough_assessment: never });
		const first = jobs.enqueue({ kind: "refresh", repository: REPO });
		const second = jobs.enqueue({ kind: "thorough_assessment", repository: REPO, number: 1 });

		await jobs.shutdown();

		expect(jobs.get(first.id)).toMatchObject({ state: "aborted" });
		expect(jobs.get(second.id)).toMatchObject({ state: "aborted" });
		expect(jobs.list({ active: true })).toEqual([]);
	});
});

describe("wait", () => {
	it("returns the stored job for one that already finished", async () => {
		const jobs = runner({ refresh: () => Promise.resolve() });
		const job = jobs.enqueue({ kind: "refresh", repository: REPO });
		await jobs.wait(job.id);

		expect(await jobs.wait(job.id)).toMatchObject({ state: "completed" });
	});

	it("complains about a job that does not exist", async () => {
		await expect(runner({}).wait("nope")).rejects.toThrow(/no job/);
	});
});
