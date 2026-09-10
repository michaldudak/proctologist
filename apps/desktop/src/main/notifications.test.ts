import type { Job, Refresh, RefreshCounts } from "@proctologist/core";
import { describe, expect, it } from "vitest";
import { assessmentNotification, refreshNotification } from "./notifications.js";

function refresh(counts: Partial<RefreshCounts>, overrides: Partial<Refresh> = {}): Refresh {
	return {
		id: 1,
		repository: "owner/thing",
		startedAt: "2026-09-09T08:00:00.000Z",
		finishedAt: "2026-09-09T08:03:00.000Z",
		outcome: "completed",
		error: null,
		errorKind: null,
		counts: { fetched: 10, added: 0, changed: 0, closed: 0, due: 0, ...counts },
		...overrides,
	};
}

function assessment(
	progress: { done: number; total: number; failed?: number },
	overrides: Partial<Job> = {},
): Job {
	return {
		id: "assessment",
		kind: "assessment",
		repository: "owner/thing",
		itemKind: null,
		number: null,
		parentId: null,
		state: "completed",
		progress,
		error: null,
		createdAt: "2026-09-09T08:00:00.000Z",
		startedAt: "2026-09-09T08:00:00.000Z",
		finishedAt: "2026-09-09T08:03:00.000Z",
		...overrides,
	};
}

describe("refreshNotification", () => {
	it("always says something about a refresh the user asked for", () => {
		expect(refreshNotification(refresh({}), { manual: true })).toEqual({
			title: "owner/thing: 10 open pull requests",
			body: "Nothing changed.",
		});
	});

	it("says nothing about a scheduled refresh that changed nothing", () => {
		expect(refreshNotification(refresh({ changed: 2, due: 2 }), { manual: false })).toBeNull();
	});

	it("summarises what the refresh found and how much is left to assess", () => {
		expect(
			refreshNotification(refresh({ added: 2, closed: 1, due: 3 }), { manual: false }),
		).toEqual({
			title: "owner/thing: 10 open pull requests",
			body: "2 new, 1 closed, 3 to assess",
		});
	});

	it("reports a failed refresh with its reason", () => {
		expect(
			refreshNotification(refresh({}, { outcome: "failed", error: "GitHub is down" }), {
				manual: true,
			}),
		).toEqual({
			title: "owner/thing: refresh failed",
			body: "GitHub is down",
		});
	});

	it("says a refresh was stopped", () => {
		expect(refreshNotification(refresh({}, { outcome: "aborted" }), { manual: true })?.title).toBe(
			"owner/thing: refresh stopped",
		);
	});
});

describe("assessmentNotification", () => {
	it("summarises a finished batch", () => {
		expect(assessmentNotification(assessment({ done: 3, total: 3, failed: 0 }))).toEqual({
			title: "owner/thing: assessment finished",
			body: "3 assessed",
		});
	});

	it("mentions pull requests it could not assess", () => {
		expect(assessmentNotification(assessment({ done: 3, total: 3, failed: 2 }))?.body).toBe(
			"1 assessed, 2 unassessed",
		);
	});

	it("reports a failed job with its reason", () => {
		expect(
			assessmentNotification(
				assessment({ done: 0, total: 2 }, { state: "failed", error: "No agent" }),
			),
		).toEqual({
			title: "owner/thing: assessment failed",
			body: "No agent",
		});
	});

	it("says a batch was stopped, and how much it skipped", () => {
		expect(
			assessmentNotification(assessment({ done: 2, total: 5, failed: 0 }, { state: "aborted" })),
		).toEqual({
			title: "owner/thing: assessment stopped",
			body: "2 assessed, 3 skipped",
		});
	});

	it("stays quiet about one pull request assessed from the side panel", () => {
		expect(assessmentNotification(assessment({ done: 1, total: 1 }, { number: 7 }))).toBeNull();
	});

	it("stays quiet about other kinds of job", () => {
		expect(
			assessmentNotification(assessment({ done: 1, total: 1 }, { kind: "thorough_assessment" })),
		).toBeNull();
	});
});
