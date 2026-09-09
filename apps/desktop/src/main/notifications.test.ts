import type { Refresh, RefreshCounts } from "@proctologist/core";
import { describe, expect, it } from "vitest";
import { refreshNotification } from "./notifications.js";

function refresh(counts: Partial<RefreshCounts>, overrides: Partial<Refresh> = {}): Refresh {
	return {
		id: 1,
		repository: "owner/thing",
		startedAt: "2026-09-09T08:00:00.000Z",
		finishedAt: "2026-09-09T08:03:00.000Z",
		outcome: "completed",
		error: null,
		counts: {
			fetched: 10,
			added: 0,
			changed: 0,
			reassessed: 0,
			unassessed: 0,
			closed: 0,
			...counts,
		},
		...overrides,
	};
}

describe("refreshNotification", () => {
	it("always says something about a refresh the user asked for", () => {
		expect(refreshNotification(refresh({}), true)).toEqual({
			title: "owner/thing: 10 open pull requests",
			body: "Nothing changed.",
		});
	});

	it("says nothing about a scheduled refresh that changed nothing", () => {
		expect(refreshNotification(refresh({}), false)).toBeNull();
	});

	it("summarises what changed", () => {
		expect(refreshNotification(refresh({ added: 2, reassessed: 3, closed: 1 }), false)).toEqual({
			title: "owner/thing: 10 open pull requests",
			body: "2 new, 3 re-assessed, 1 closed",
		});
	});

	it("mentions pull requests it could not assess", () => {
		expect(refreshNotification(refresh({ added: 1, unassessed: 2 }), true)?.body).toBe(
			"1 new, 2 unassessed",
		);
	});

	it("reports a failure with its reason", () => {
		expect(
			refreshNotification(refresh({}, { outcome: "failed", error: "GitHub is down" }), true),
		).toEqual({
			title: "owner/thing: refresh failed",
			body: "GitHub is down",
		});
	});

	it("says a refresh was stopped", () => {
		expect(
			refreshNotification(refresh({ reassessed: 1 }, { outcome: "aborted" }), true)?.title,
		).toBe("owner/thing: refresh stopped");
	});
});
