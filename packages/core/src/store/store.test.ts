import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openStore, type Store } from "./store.js";
import {
	isSnoozeActive,
	type AssessmentVerdict,
	type PullRequestFacts,
	type RefreshCounts,
} from "./types.js";

const REPO = "owner/thing";
const NOW = "2026-09-09T12:00:00.000Z";

let store: Store;

beforeEach(() => {
	store = openStore(":memory:");
});

afterEach(() => {
	store.close();
});

function facts(number: number, overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
	return {
		repository: REPO,
		kind: "pull_request",
		number,
		title: `Pull request ${number}`,
		url: `https://github.com/${REPO}/pull/${number}`,
		author: "someone",
		isBot: false,
		authorAssociation: "CONTRIBUTOR",
		authoredByUser: false,
		reviewRequestedFromUser: false,
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
		changedAt: "2026-09-01T00:00:00.000Z",
		isDraft: false,
		labels: ["bug"],
		headSha: "a".repeat(40),
		baseRef: "master",
		additions: 10,
		deletions: 2,
		changedFiles: 3,
		mergeable: "MERGEABLE",
		reviewDecision: null,
		checks: { state: "passing", passed: 4, failed: 0, pending: 0 },
		lastActivityBy: "someone",
		lastActivityAt: "2026-09-01T00:00:00.000Z",
		...overrides,
	};
}

function verdict(overrides: Partial<AssessmentVerdict> = {}): AssessmentVerdict {
	return {
		nextAction: "review",
		nextActionReason: "It is ready.",
		area: "bug fix",
		relevance: "relevant",
		relevanceReason: "Still applies.",
		status: "ready",
		statusReason: "Checks pass.",
		effort: "S",
		effortReason: "Three files.",
		priority: "medium",
		priorityReason: "Users hit it weekly.",
		summary: "A small fix.",
		confidence: 0.8,
		evidence: [{ note: "checks are green" }],
		...overrides,
	};
}

function counts(overrides: Partial<RefreshCounts> = {}): RefreshCounts {
	return {
		fetched: 3,
		added: 1,
		changed: 1,
		closed: 0,
		due: 2,
		...overrides,
	};
}

describe("openStore", () => {
	it("applies the migrations and reports the schema version", () => {
		expect(store.schemaVersion).toBeGreaterThan(0);
	});

	it("creates the containing directory and reopens an existing database", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "proctologist-store-"));
		const file = path.join(dir, "nested", "data.sqlite");
		try {
			const first = openStore(file);
			first.items.upsert(facts(1), NOW);
			first.close();

			const second = openStore(file);
			expect(second.items.get({ repository: REPO, number: 1 })?.title).toBe("Pull request 1");
			second.close();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

describe("items", () => {
	it("round-trips every fact", () => {
		store.items.upsert(facts(7, { labels: ["a", "b"], isDraft: true }), NOW);

		const stored = store.items.get({ repository: REPO, number: 7 });

		expect(stored).toMatchObject({
			...facts(7, { labels: ["a", "b"], isDraft: true }),
			closedAt: null,
			fetchedAt: NOW,
		});
	});

	it("updates an existing row instead of duplicating it", () => {
		store.items.upsert(facts(7), NOW);
		store.items.upsert(facts(7, { title: "Renamed" }), NOW);

		expect(store.items.list(REPO)).toHaveLength(1);
		expect(store.items.get({ repository: REPO, number: 7 })?.title).toBe("Renamed");
	});

	it("hides closed pull requests unless asked for them", () => {
		store.items.upsertMany([facts(1), facts(2)], NOW);

		const closed = store.items.closeMissing(REPO, [1], NOW);

		expect(closed).toEqual([2]);
		expect(store.items.list(REPO).map((pr) => pr.number)).toEqual([1]);
		expect(store.items.list(REPO, { includeClosed: true })).toHaveLength(2);
		expect(store.items.get({ repository: REPO, number: 2 })?.closedAt).toBe(NOW);
	});

	it("reopens a pull request that appears in the open list again", () => {
		store.items.upsert(facts(1), NOW);
		store.items.closeMissing(REPO, [], NOW);

		store.items.upsert(facts(1), NOW);

		expect(store.items.get({ repository: REPO, number: 1 })?.closedAt).toBeNull();
	});

	it("purges closed pull requests older than the cut-off, and their assessments", () => {
		store.items.upsertMany([facts(1), facts(2)], NOW);
		store.assessments.add(
			{
				repository: REPO,
				number: 1,
				depth: "quick",
				headSha: "a",
				updatedAtSeen: "u",
				verdict: verdict(),
			},
			NOW,
		);
		store.items.closeMissing(REPO, [], "2026-01-01T00:00:00.000Z");

		const purged = store.items.purgeClosed(REPO, { before: "2026-02-01T00:00:00.000Z" });

		expect(purged).toBe(2);
		expect(store.items.list(REPO, { includeClosed: true })).toHaveLength(0);
		expect(store.assessments.current({ repository: REPO, number: 1 })).toBeUndefined();
	});

	it("keeps a closed pull request the user left a note on", () => {
		store.items.upsert(facts(1), NOW);
		store.notes.set({ repository: REPO, number: 1 }, "Come back to this.", NOW);
		store.items.closeMissing(REPO, [], "2026-01-01T00:00:00.000Z");

		expect(store.items.purgeClosed(REPO, { before: "2026-02-01T00:00:00.000Z" })).toBe(0);
	});

	it("does not purge a pull request closed after the cut-off", () => {
		store.items.upsert(facts(1), NOW);
		store.items.closeMissing(REPO, [], NOW);

		expect(store.items.purgeClosed(REPO, { before: "2026-01-01T00:00:00.000Z" })).toBe(0);
	});
});

describe("assessments", () => {
	const ref = { repository: REPO, number: 1 };

	beforeEach(() => {
		store.items.upsert(facts(1), NOW);
	});

	it("reads back an assessment judged before priority existed as having none", () => {
		store.assessments.add(
			{
				...ref,
				depth: "quick",
				headSha: "a",
				updatedAtSeen: "u",
				verdict: verdict({ priority: null, priorityReason: "" }),
			},
			NOW,
		);

		const current = store.assessments.current(ref);

		expect(current?.verdict?.priority).toBeNull();
		expect(current?.verdict?.priorityReason).toBe("");
	});

	it("appends and returns the newest as current", () => {
		store.assessments.add(
			{ ...ref, depth: "quick", headSha: "a", updatedAtSeen: "u", verdict: verdict() },
			NOW,
		);
		const second = store.assessments.add(
			{
				...ref,
				depth: "thorough",
				headSha: "b",
				updatedAtSeen: "v",
				verdict: verdict({ nextAction: "merge" }),
				model: "a-model",
				durationMs: 1234,
			},
			NOW,
		);

		const current = store.assessments.current(ref);

		expect(current?.id).toBe(second.id);
		expect(current?.depth).toBe("thorough");
		expect(current?.verdict?.nextAction).toBe("merge");
		expect(current?.model).toBe("a-model");
		expect(current?.durationMs).toBe(1234);
		expect(store.assessments.history(ref)).toHaveLength(2);
		expect(store.assessments.previous(ref)?.verdict?.nextAction).toBe("review");
	});

	it("round-trips the verdict including evidence", () => {
		const judged = verdict({ evidence: [{ note: "CI is red", url: "https://example.test/1" }] });
		store.assessments.add(
			{ ...ref, depth: "quick", headSha: "a", updatedAtSeen: "u", verdict: judged },
			NOW,
		);

		expect(store.assessments.current(ref)?.verdict).toEqual(judged);
	});

	it("records an unassessed pull request with no verdict and an error", () => {
		store.assessments.add(
			{
				...ref,
				depth: "quick",
				headSha: "a",
				updatedAtSeen: "u",
				verdict: null,
				error: "timed out",
			},
			NOW,
		);

		const current = store.assessments.current(ref);

		expect(current?.verdict).toBeNull();
		expect(current?.error).toBe("timed out");
	});

	it("lists the current assessment of every item in the repository", () => {
		store.items.upsert(facts(2), NOW);
		store.assessments.add(
			{ ...ref, depth: "quick", headSha: "a", updatedAtSeen: "u", verdict: verdict() },
			NOW,
		);
		store.assessments.add(
			{ ...ref, depth: "quick", headSha: "b", updatedAtSeen: "u", verdict: verdict() },
			NOW,
		);
		store.assessments.add(
			{
				repository: REPO,
				number: 2,
				depth: "quick",
				headSha: "c",
				updatedAtSeen: "u",
				verdict: verdict(),
			},
			NOW,
		);

		const current = store.assessments.currentForRepository(REPO);

		expect(current.map((item) => item.number)).toEqual([2, 1]);
		expect(current.find((item) => item.number === 1)?.headSha).toBe("b");
	});

	describe("outdated", () => {
		const options = { outdatedAfterDays: 14, now: NOW };

		it("includes a pull request that was never assessed", () => {
			expect(store.assessments.outdated(REPO, options)).toEqual([1]);
		});

		it("excludes a pull request assessed at its current head and update time", () => {
			store.assessments.add(
				{
					...ref,
					depth: "quick",
					headSha: facts(1).headSha,
					updatedAtSeen: facts(1).updatedAt,
					verdict: verdict(),
				},
				NOW,
			);

			expect(store.assessments.outdated(REPO, options)).toEqual([]);
		});

		it("includes a pull request whose head moved", () => {
			store.assessments.add(
				{
					...ref,
					depth: "quick",
					headSha: "old",
					updatedAtSeen: facts(1).updatedAt,
					verdict: verdict(),
				},
				NOW,
			);

			expect(store.assessments.outdated(REPO, options)).toEqual([1]);
		});

		it("includes a pull request that was edited without a new commit", () => {
			store.assessments.add(
				{
					...ref,
					depth: "quick",
					headSha: facts(1).headSha,
					updatedAtSeen: "older",
					verdict: verdict(),
				},
				NOW,
			);

			expect(store.assessments.outdated(REPO, options)).toEqual([1]);
		});

		it("includes an assessment older than the cut-off", () => {
			store.assessments.add(
				{
					...ref,
					depth: "quick",
					headSha: facts(1).headSha,
					updatedAtSeen: facts(1).updatedAt,
					verdict: verdict(),
					createdAt: "2026-01-01T00:00:00.000Z",
				},
				NOW,
			);

			expect(store.assessments.outdated(REPO, options)).toEqual([1]);
		});

		it("retries a pull request left unassessed", () => {
			store.assessments.add(
				{
					...ref,
					depth: "quick",
					headSha: facts(1).headSha,
					updatedAtSeen: facts(1).updatedAt,
					verdict: null,
					error: "timed out",
				},
				NOW,
			);

			expect(store.assessments.outdated(REPO, options)).toEqual([1]);
		});

		it("says why each one is due", () => {
			store.items.upsertMany([facts(2), facts(3)], NOW);
			store.assessments.add(
				{
					...ref,
					depth: "quick",
					headSha: "old",
					updatedAtSeen: facts(1).updatedAt,
					verdict: verdict(),
				},
				NOW,
			);
			store.assessments.add(
				{
					repository: REPO,
					number: 2,
					depth: "quick",
					headSha: facts(2).headSha,
					updatedAtSeen: facts(2).updatedAt,
					verdict: null,
					error: "timed out",
				},
				NOW,
			);
			store.assessments.add(
				{
					repository: REPO,
					number: 3,
					depth: "quick",
					headSha: facts(3).headSha,
					updatedAtSeen: facts(3).updatedAt,
					verdict: verdict(),
					createdAt: "2026-01-01T00:00:00.000Z",
				},
				NOW,
			);

			expect(store.assessments.outdatedItems(REPO, options)).toEqual([
				{ number: 1, reason: "changed" },
				{ number: 2, reason: "failed" },
				{ number: 3, reason: "aged" },
			]);
		});

		it("calls a pull request that has never been assessed exactly that", () => {
			expect(store.assessments.outdatedItems(REPO, options)).toEqual([
				{ number: 1, reason: "never" },
			]);
		});

		it("ignores closed pull requests", () => {
			store.items.closeMissing(REPO, [], NOW);

			expect(store.assessments.outdated(REPO, options)).toEqual([]);
		});
	});
});

describe("notes", () => {
	const ref = { repository: REPO, number: 1 };

	beforeEach(() => {
		store.items.upsert(facts(1), NOW);
	});

	it("stores and replaces the text", () => {
		store.notes.set(ref, "First", NOW);
		store.notes.set(ref, "Second", "2026-09-10T00:00:00.000Z");

		expect(store.notes.get(ref)).toMatchObject({
			text: "Second",
			updatedAt: "2026-09-10T00:00:00.000Z",
		});
		expect(store.notes.list(REPO)).toHaveLength(1);
	});

	it("clears the note when set to blank text", () => {
		store.notes.set(ref, "Something", NOW);
		store.notes.set(ref, "   ", NOW);

		expect(store.notes.get(ref)).toBeUndefined();
	});

	it("survives a new assessment", () => {
		store.notes.set(ref, "Keep me", NOW);
		store.assessments.add(
			{ ...ref, depth: "quick", headSha: "a", updatedAtSeen: "u", verdict: verdict() },
			NOW,
		);

		expect(store.notes.get(ref)?.text).toBe("Keep me");
	});
});

describe("snoozes", () => {
	const ref = { repository: REPO, number: 1 };

	beforeEach(() => {
		store.items.upsert(facts(1), NOW);
	});

	it("hides an item until its assessment is replaced", () => {
		const assessment = store.assessments.add(
			{ ...ref, depth: "quick", headSha: "a", updatedAtSeen: "u", verdict: verdict() },
			NOW,
		);
		store.snoozes.untilAssessmentChanges(ref, assessment.id, NOW);
		const snooze = store.snoozes.get(ref);

		expect(snooze).toBeDefined();
		expect(isSnoozeActive(snooze!, { currentAssessmentId: assessment.id, now: NOW })).toBe(true);

		const replacement = store.assessments.add(
			{ ...ref, depth: "quick", headSha: "b", updatedAtSeen: "v", verdict: verdict() },
			NOW,
		);

		expect(isSnoozeActive(snooze!, { currentAssessmentId: replacement.id, now: NOW })).toBe(false);
	});

	it("hides an item until a date", () => {
		store.snoozes.untilDate(ref, "2026-09-20T00:00:00.000Z", NOW);
		const snooze = store.snoozes.get(ref)!;

		expect(isSnoozeActive(snooze, { now: NOW })).toBe(true);
		expect(isSnoozeActive(snooze, { now: "2026-09-21T00:00:00.000Z" })).toBe(false);
	});

	it("replaces one kind of snooze with the other and can be cleared", () => {
		store.snoozes.untilDate(ref, "2026-09-20T00:00:00.000Z", NOW);
		store.snoozes.untilAssessmentChanges(ref, 5, NOW);

		expect(store.snoozes.get(ref)).toMatchObject({ untilDate: null, untilAssessmentId: 5 });

		store.snoozes.clear(ref);

		expect(store.snoozes.get(ref)).toBeUndefined();
		expect(store.snoozes.list(REPO)).toEqual([]);
	});
});

describe("analyses", () => {
	const ref = { repository: REPO, number: 1 };

	function assess(depth: "quick" | "thorough", headSha: string) {
		return store.assessments.add(
			{ ...ref, depth, headSha, updatedAtSeen: NOW, verdict: verdict(), agent: "claude" },
			NOW,
		);
	}

	beforeEach(() => {
		store.items.upsert(facts(1), NOW);
	});

	it("keeps the markdown with the assessment it explains", () => {
		const thorough = assess("thorough", "b");

		const analysis = store.analyses.add(thorough.id, "## Background\n\nText.");

		expect(analysis).toEqual({
			...ref,
			kind: "pull_request",
			assessmentId: thorough.id,
			markdown: "## Background\n\nText.",
			headSha: "b",
			agent: "claude",
			model: null,
			createdAt: NOW,
		});
		expect(store.analyses.get(thorough.id)).toEqual(analysis);
		expect(store.analyses.get(thorough.id + 1)).toBeUndefined();
	});

	it("still finds the latest analysis once a quick assessment has replaced the thorough one", () => {
		store.analyses.add(assess("thorough", "a").id, "First");
		const second = assess("thorough", "b");
		store.analyses.add(second.id, "Second");
		assess("quick", "c");

		expect(store.analyses.latest(ref)).toMatchObject({
			assessmentId: second.id,
			markdown: "Second",
			headSha: "b",
		});
		expect(store.analyses.latest({ repository: REPO, number: 2 })).toBeUndefined();
	});

	it("knows whether an item has an analysis without reading it", () => {
		store.items.upsert(facts(2), NOW);
		expect(store.analyses.has(ref)).toBe(false);

		store.analyses.add(assess("thorough", "a").id, "Text.");
		assess("quick", "b");

		expect(store.analyses.has(ref)).toBe(true);
		expect(store.analyses.has({ repository: REPO, number: 2 })).toBe(false);
	});

	it("goes when its pull request is purged", () => {
		store.items.upsert(facts(1), NOW);
		const thorough = assess("thorough", "a");
		store.analyses.add(thorough.id, "Text.");
		store.items.closeMissing(REPO, [], "2026-01-01T00:00:00.000Z");

		store.items.purgeClosed(REPO, { before: NOW });

		expect(store.analyses.get(thorough.id)).toBeUndefined();
	});
});

describe("reviewDrafts", () => {
	const ref = { repository: REPO, number: 1 };

	beforeEach(() => {
		store.items.upsert(facts(1), NOW);
	});

	it("keeps the findings, the verdict and the agent session", () => {
		store.reviewDrafts.add(
			{
				...ref,
				headSha: "a",
				summary: "Looks fine.",
				verdict: "approve",
				findings: [{ title: "Typo", body: "In the readme.", path: "README.md", line: 3 }],
				sessionId: "session-1",
				model: "a-model",
			},
			NOW,
		);

		const latest = store.reviewDrafts.latest(ref);

		expect(latest?.sessionId).toBe("session-1");
		expect(latest?.findings).toEqual([
			{ title: "Typo", body: "In the readme.", path: "README.md", line: 3 },
		]);
	});

	it("keeps earlier drafts in history, newest first", () => {
		const base = { ...ref, headSha: "a", verdict: "comment", findings: [], sessionId: null };
		store.reviewDrafts.add({ ...base, summary: "First" }, NOW);
		store.reviewDrafts.add({ ...base, summary: "Second" }, NOW);

		expect(store.reviewDrafts.history(ref).map((draft) => draft.summary)).toEqual([
			"Second",
			"First",
		]);
	});
});

describe("jobs", () => {
	it("moves a job through its states", () => {
		store.jobs.create({ id: "job-1", kind: "refresh", repository: REPO }, NOW);
		store.jobs.start("job-1", NOW);
		store.jobs.reportProgress("job-1", { done: 1, total: 4, label: "assessing" });
		store.jobs.finish("job-1", "completed", "2026-09-09T12:05:00.000Z");

		expect(store.jobs.get("job-1")).toMatchObject({
			state: "completed",
			progress: { done: 1, total: 4, label: "assessing" },
			startedAt: NOW,
			finishedAt: "2026-09-09T12:05:00.000Z",
			error: null,
		});
	});

	it("keeps the job that queued it and the size it was queued with", () => {
		store.jobs.create({ id: "job-1", kind: "refresh", repository: REPO }, NOW);
		store.jobs.create(
			{
				id: "job-2",
				kind: "assessment",
				repository: REPO,
				parentId: "job-1",
				progress: { done: 0, total: 7 },
			},
			NOW,
		);

		expect(store.jobs.get("job-2")).toMatchObject({
			parentId: "job-1",
			progress: { done: 0, total: 7 },
		});
		expect(store.jobs.get("job-1")?.parentId).toBeNull();
	});

	it("lists only the jobs created since an instant", () => {
		store.jobs.create({ id: "old", kind: "refresh", repository: REPO }, "2026-09-08T12:00:00.000Z");
		store.jobs.finish("old", "completed", "2026-09-08T12:01:00.000Z");
		store.jobs.create({ id: "new", kind: "refresh", repository: REPO }, NOW);

		expect(store.jobs.list({ since: NOW }).map((job) => job.id)).toEqual(["new"]);
		expect(store.jobs.list().map((job) => job.id)).toEqual(["new", "old"]);
	});

	it("refuses a second active refresh of the same repository", () => {
		store.jobs.create({ id: "job-1", kind: "refresh", repository: REPO }, NOW);

		expect(() =>
			store.jobs.create({ id: "job-2", kind: "refresh", repository: REPO }, NOW),
		).toThrow(/already running/);
	});

	it("allows a refresh of another repository and other job kinds", () => {
		store.jobs.create({ id: "job-1", kind: "refresh", repository: REPO }, NOW);
		store.jobs.create({ id: "job-2", kind: "refresh", repository: "owner/other" }, NOW);
		store.jobs.create({ id: "job-3", kind: "review_draft", repository: REPO, number: 4 }, NOW);

		expect(store.jobs.list({ active: true })).toHaveLength(3);
		expect(store.jobs.get("job-3")).toMatchObject({ number: 4, itemKind: "pull_request" });
	});

	it("allows a new refresh once the previous one finished", () => {
		store.jobs.create({ id: "job-1", kind: "refresh", repository: REPO }, NOW);
		store.jobs.finish("job-1", "aborted", NOW);

		expect(() =>
			store.jobs.create({ id: "job-2", kind: "refresh", repository: REPO }, NOW),
		).not.toThrow();
	});

	it("refuses to start a job that is not queued", () => {
		store.jobs.create({ id: "job-1", kind: "refresh", repository: REPO }, NOW);
		store.jobs.start("job-1", NOW);

		expect(() => store.jobs.start("job-1", NOW)).toThrow(/not queued/);
	});

	it("fails jobs left active by a previous process", () => {
		store.jobs.create({ id: "job-1", kind: "refresh", repository: REPO }, NOW);
		store.jobs.start("job-1", NOW);

		expect(store.jobs.recoverInterrupted(NOW)).toBe(1);
		expect(store.jobs.get("job-1")).toMatchObject({ state: "failed" });
		expect(store.jobs.list({ active: true })).toEqual([]);
	});

	it("records an abort request for another process to notice", () => {
		store.jobs.create({ id: "job-1", kind: "refresh", repository: REPO }, NOW);
		store.jobs.start("job-1", NOW);

		expect(store.jobs.requestAbort("job-1")).toBe(true);
		expect(store.jobs.abortRequested()).toEqual(["job-1"]);
	});

	it("will not flag a job that already finished", () => {
		store.jobs.create({ id: "job-1", kind: "refresh", repository: REPO }, NOW);
		store.jobs.finish("job-1", "completed", NOW);

		expect(store.jobs.requestAbort("job-1")).toBe(false);
		expect(store.jobs.abortRequested()).toEqual([]);
	});

	it("filters by repository", () => {
		store.jobs.create({ id: "job-1", kind: "refresh", repository: REPO }, NOW);
		store.jobs.create({ id: "job-2", kind: "refresh", repository: "owner/other" }, NOW);

		expect(store.jobs.list({ repository: REPO }).map((job) => job.id)).toEqual(["job-1"]);
	});
});

describe("refreshes", () => {
	it("records the outcome and the counts", () => {
		store.refreshes.record({
			repository: REPO,
			startedAt: NOW,
			finishedAt: "2026-09-09T12:03:00.000Z",
			outcome: "completed",
			counts: counts(),
		});
		const second = store.refreshes.record({
			repository: REPO,
			startedAt: "2026-09-10T12:00:00.000Z",
			finishedAt: "2026-09-10T12:01:00.000Z",
			outcome: "aborted",
			counts: counts({ due: 0 }),
			error: null,
		});

		expect(store.refreshes.latest(REPO)).toMatchObject({ id: second.id, outcome: "aborted" });
		expect(store.refreshes.history(REPO)).toHaveLength(2);
		expect(store.refreshes.latest(REPO)?.counts).toEqual(counts({ due: 0 }));
	});
});

describe("transaction", () => {
	it("rolls back everything when the work throws", () => {
		expect(() =>
			store.transaction(() => {
				store.items.upsert(facts(1), NOW);
				throw new Error("nope");
			}),
		).toThrow("nope");

		expect(store.items.list(REPO)).toEqual([]);
	});
});
