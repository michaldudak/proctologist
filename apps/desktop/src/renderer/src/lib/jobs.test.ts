import { describe, expect, it } from "vitest";
import type { Job } from "../../../shared/ipc.js";
import { activitySummary, elapsed, jobStatus, jobTitle } from "./jobs.js";

function job(overrides: Partial<Job>): Job {
	return {
		id: "job",
		kind: "assessment",
		repository: "owner/thing",
		itemKind: null,
		number: null,
		parentId: null,
		state: "running",
		progress: null,
		error: null,
		createdAt: "2026-09-09T12:00:00.000Z",
		startedAt: "2026-09-09T12:00:00.000Z",
		finishedAt: null,
		...overrides,
	};
}

describe("jobTitle", () => {
	it("says what each kind of job is about", () => {
		expect(jobTitle(job({ kind: "refresh" }))).toBe("Refresh");
		expect(jobTitle(job({ progress: { done: 0, total: 12 } }))).toBe("Assess 12 pull requests");
		expect(jobTitle(job({ progress: { done: 0, total: 1 } }))).toBe("Assess 1 pull request");
		expect(jobTitle(job({ number: 42 }))).toBe("Assess #42");
		expect(jobTitle(job({ kind: "thorough_assessment", number: 42 }))).toBe(
			"Assess #42 thoroughly",
		);
		expect(jobTitle(job({ kind: "review_draft", number: 42 }))).toBe("Draft a review of #42");
	});
});

describe("jobStatus", () => {
	it("reads the progress while running and the outcome once done", () => {
		expect(jobStatus(job({ state: "queued" }))).toBe("Waiting its turn");
		expect(jobStatus(job({ progress: { done: 3, total: 12, label: "Assessed 3 of 12" } }))).toBe(
			"Assessed 3 of 12",
		);
		expect(
			jobStatus(job({ state: "completed", progress: { done: 12, total: 12, failed: 1 } })),
		).toBe("11 assessed, 1 unassessed");
		expect(jobStatus(job({ state: "completed", progress: { done: 12, total: 12 } }))).toBe(
			"12 assessed",
		);
	});

	it("says how far a stopped assessment got", () => {
		expect(jobStatus(job({ state: "aborted", progress: { done: 2, total: 5, failed: 1 } }))).toBe(
			"Stopped after 2 of 5, 1 assessed, 1 unassessed",
		);
		expect(jobStatus(job({ kind: "refresh", state: "aborted" }))).toBe("Stopped");
	});

	it("says why a job failed", () => {
		expect(jobStatus(job({ state: "failed", error: "gh is not on PATH" }))).toBe(
			"gh is not on PATH",
		);
	});

	it("keeps a finished refresh's own summary", () => {
		expect(
			jobStatus(
				job({
					kind: "refresh",
					state: "completed",
					progress: { done: 1, total: 1, label: "45 open" },
				}),
			),
		).toBe("45 open");
	});
});

describe("activitySummary", () => {
	it("is silent when nothing is running", () => {
		expect(activitySummary([job({ state: "completed" })])).toBeNull();
	});

	it("names the one thing running", () => {
		expect(activitySummary([job({ progress: { done: 3, total: 12 } })])).toBe("Assessing 3 of 12");
		expect(activitySummary([job({ kind: "refresh" })])).toBe("Fetching…");
		expect(activitySummary([job({ state: "queued" })])).toBe("Queued");
	});

	it("counts the queue behind the one running", () => {
		expect(
			activitySummary([
				job({ kind: "refresh" }),
				job({ id: "b", state: "queued" }),
				job({ id: "c", state: "completed" }),
			]),
		).toBe("Fetching… · 1 queued");
	});

	it("counts several running jobs", () => {
		expect(activitySummary([job({}), job({ id: "b", kind: "refresh" })])).toBe("2 jobs");
	});
});

describe("elapsed", () => {
	it("reads like a stopwatch", () => {
		expect(elapsed("2026-09-09T12:00:00.000Z", "2026-09-09T12:00:04.000Z")).toBe("4 s");
		expect(elapsed("2026-09-09T12:00:00.000Z", "2026-09-09T12:02:30.000Z")).toBe("2 min");
		expect(elapsed("2026-09-09T12:00:00.000Z", "2026-09-09T13:05:00.000Z")).toBe("1 h 5 min");
	});
});
