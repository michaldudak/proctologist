import { describe, expect, it } from "vitest";
import type { Assessment, AssessmentVerdict, Snooze, StoredItem } from "../store/types.js";
import {
	ageInDays,
	changedVerdicts,
	compareForTable,
	derive,
	isQuickWin,
	isSnoozed,
	nextActionRank,
	priorityRank,
	type PullRequestView,
} from "./index.js";

const NOW = "2026-09-09T12:00:00.000Z";

function verdict(overrides: Partial<AssessmentVerdict> = {}): AssessmentVerdict {
	return {
		nextAction: "review",
		nextActionReason: "r",
		area: "bug_fix",
		relevance: "still_relevant",
		relevanceReason: "r",
		status: "waiting_on_maintainer",
		statusReason: "r",
		effort: "S",
		effortReason: "r",
		priority: "medium",
		priorityReason: "r",
		summary: "s",
		confidence: 0.5,
		evidence: [],
		...overrides,
	};
}

function assessment(overrides: Partial<Assessment> = {}): Assessment {
	return {
		id: 1,
		repository: "owner/thing",
		kind: "pull_request",
		number: 1,
		depth: "quick",
		headSha: "a",
		updatedAtSeen: "2026-09-01T00:00:00.000Z",
		verdict: verdict(),
		error: null,
		agent: "codex",
		model: null,
		durationMs: null,
		createdAt: "2026-09-02T00:00:00.000Z",
		...overrides,
	};
}

function item(overrides: Partial<StoredItem> = {}): StoredItem {
	return {
		repository: "owner/thing",
		kind: "pull_request",
		number: 1,
		title: "t",
		url: "u",
		author: "a",
		isBot: false,
		authorAssociation: "CONTRIBUTOR",
		authoredByUser: false,
		reviewRequestedFromUser: false,
		createdAt: "2026-08-30T12:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
		isDraft: false,
		labels: [],
		headSha: "a",
		baseRef: "master",
		additions: 1,
		deletions: 1,
		changedFiles: 1,
		mergeable: null,
		reviewDecision: null,
		checks: { state: "none", passed: 0, failed: 0, pending: 0 },
		lastActivityBy: null,
		lastActivityAt: "2026-09-04T12:00:00.000Z",
		closedAt: null,
		fetchedAt: NOW,
		...overrides,
	};
}

function view(overrides: Partial<PullRequestView> = {}): PullRequestView {
	return {
		item: item(),
		assessment: assessment(),
		previousAssessment: undefined,
		hasNote: false,
		snooze: undefined,
		...overrides,
	};
}

describe("isQuickWin", () => {
	it.each([
		["merge", "XS", true],
		["review", "S", true],
		["merge", "M", false],
		["close", "XS", false],
		["wait", "XL", false],
	] as const)("is %s/%s -> %s", (nextAction, effort, expected) => {
		expect(isQuickWin(verdict({ nextAction, effort }))).toBe(expected);
	});

	it("is false without a verdict", () => {
		expect(isQuickWin(null)).toBe(false);
	});
});

describe("priorityRank", () => {
	it("puts critical first, low last, and none after low", () => {
		expect(priorityRank("critical")).toBeLessThan(priorityRank("high"));
		expect(priorityRank("low")).toBeGreaterThan(priorityRank("medium"));
		expect(priorityRank(null)).toBeGreaterThan(priorityRank("low"));
	});
});

describe("nextActionRank", () => {
	it("puts merge first and wait last", () => {
		expect(nextActionRank("merge")).toBeLessThan(nextActionRank("review"));
		expect(nextActionRank("wait")).toBeGreaterThan(nextActionRank("decide"));
	});
});

describe("changedVerdicts", () => {
	it("lists only the verdicts that differ", () => {
		expect(
			changedVerdicts(
				assessment({ verdict: verdict({ nextAction: "merge", effort: "XS", priority: "high" }) }),
				assessment({ verdict: verdict() }),
			),
		).toEqual(["nextAction", "effort", "priority"]);
	});

	it("ignores reworded reasons and summaries", () => {
		expect(
			changedVerdicts(
				assessment({ verdict: verdict({ summary: "different", nextActionReason: "other" }) }),
				assessment({ verdict: verdict() }),
			),
		).toEqual([]);
	});

	it("says nothing when there is no earlier assessment or no verdict", () => {
		expect(changedVerdicts(assessment(), undefined)).toEqual([]);
		expect(changedVerdicts(assessment({ verdict: null }), assessment())).toEqual([]);
	});
});

describe("ageInDays", () => {
	it("counts whole days and never goes negative", () => {
		expect(ageInDays("2026-09-04T12:00:00.000Z", NOW)).toBe(5);
		expect(ageInDays("2026-09-09T11:00:00.000Z", NOW)).toBe(0);
		expect(ageInDays("2026-09-10T12:00:00.000Z", NOW)).toBe(0);
	});
});

describe("isSnoozed", () => {
	const snooze = (overrides: Partial<Snooze>): Snooze => ({
		repository: "owner/thing",
		kind: "pull_request",
		number: 1,
		untilAssessmentId: null,
		untilDate: null,
		createdAt: NOW,
		...overrides,
	});

	it("holds until the assessment is replaced", () => {
		expect(isSnoozed(snooze({ untilAssessmentId: 1 }), { currentAssessmentId: 1, now: NOW })).toBe(
			true,
		);
		expect(isSnoozed(snooze({ untilAssessmentId: 1 }), { currentAssessmentId: 2, now: NOW })).toBe(
			false,
		);
	});

	it("holds until a date", () => {
		expect(isSnoozed(snooze({ untilDate: "2026-09-20T00:00:00.000Z" }), { now: NOW })).toBe(true);
		expect(isSnoozed(snooze({ untilDate: "2026-09-01T00:00:00.000Z" }), { now: NOW })).toBe(false);
	});

	it("is false when there is no snooze", () => {
		expect(isSnoozed(undefined, { now: NOW })).toBe(false);
	});
});

describe("derive", () => {
	it("collects the fields the table shows", () => {
		expect(derive(view(), NOW)).toEqual({
			quickWin: true,
			unassessed: false,
			changed: [],
			snoozed: false,
			ageDays: 10,
			lastActivityDays: 5,
			assessmentOutdated: false,
		});
	});

	it("calls a pull request unassessed when the assessment failed or is missing", () => {
		expect(derive(view({ assessment: undefined }), NOW).unassessed).toBe(true);
		expect(derive(view({ assessment: assessment({ verdict: null }) }), NOW).unassessed).toBe(true);
	});

	it("notices an assessment made against an older head or update", () => {
		expect(
			derive(view({ assessment: assessment({ headSha: "older" }) }), NOW).assessmentOutdated,
		).toBe(true);
		expect(
			derive(view({ assessment: assessment({ updatedAtSeen: "older" }) }), NOW).assessmentOutdated,
		).toBe(true);
	});
});

describe("compareForTable", () => {
	function row(overrides: Partial<PullRequestView>) {
		const base = view(overrides);
		return { ...base, derived: derive(base, NOW) };
	}

	it("orders by next action, then quick wins, then recent activity", () => {
		const merge = row({ assessment: assessment({ verdict: verdict({ nextAction: "merge" }) }) });
		const wait = row({ assessment: assessment({ verdict: verdict({ nextAction: "wait" }) }) });
		const unassessed = row({ assessment: undefined });

		expect(
			[wait, unassessed, merge].toSorted(compareForTable).map((sorted) => sorted.assessment?.id),
		).toEqual([1, 1, undefined]);
		expect(compareForTable(merge, wait)).toBeLessThan(0);
		expect(compareForTable(wait, unassessed)).toBeLessThan(0);
	});

	it("puts a quick win above a slower pull request needing the same action", () => {
		const quick = row({
			assessment: assessment({ verdict: verdict({ nextAction: "review", effort: "XS" }) }),
		});
		const slow = row({
			assessment: assessment({ verdict: verdict({ nextAction: "review", effort: "XL" }) }),
		});

		expect(compareForTable(quick, slow)).toBeLessThan(0);
	});
});
