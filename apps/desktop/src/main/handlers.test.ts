import {
	createJobRunner,
	openStore,
	parseConfig,
	resolvePaths,
	type App,
	type AssessmentVerdict,
	type CodexRunner,
	type GitHubClient,
	type JobHandler,
	type PullRequestFacts,
	type RefreshService,
	type Store,
	type WorktreeManager,
} from "@proctologist/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandlers, type Handlers } from "./handlers.js";

const REPO = "owner/thing";
const NOW = "2026-09-09T12:00:00.000Z";

let store: Store;
let app: App;
let handlers: Handlers;
let openExternal: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>;
let writeClipboard: ReturnType<typeof vi.fn<(text: string) => void>>;
let dataChanged: ReturnType<typeof vi.fn<(repository: string | null) => void>>;
let refreshHandler: JobHandler;
let quickAssessments: number;

function verdict(overrides: Partial<AssessmentVerdict> = {}): AssessmentVerdict {
	return {
		nextAction: "merge",
		nextActionReason: "Approved and green.",
		category: "bug_fix",
		relevance: "still_relevant",
		relevanceReason: "r",
		status: "ready_to_merge",
		statusReason: "r",
		effort: "XS",
		effortReason: "r",
		summary: "Fixes an off-by-one.",
		confidence: 0.9,
		evidence: [],
		...overrides,
	};
}

function facts(number: number, overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
	return {
		repository: REPO,
		kind: "pull_request",
		number,
		title: `Pull request ${number}`,
		url: `https://github.com/${REPO}/pull/${number}`,
		author: "contributor",
		isBot: false,
		authoredByUser: false,
		reviewRequestedFromUser: false,
		createdAt: "2026-09-01T12:00:00.000Z",
		updatedAt: "2026-09-02T12:00:00.000Z",
		isDraft: false,
		labels: [],
		headSha: "sha",
		baseRef: "master",
		additions: 1,
		deletions: 1,
		changedFiles: 1,
		mergeable: null,
		reviewDecision: null,
		checks: { state: "none", passed: 0, failed: 0, pending: 0 },
		lastActivityBy: null,
		lastActivityAt: "2026-09-02T12:00:00.000Z",
		...overrides,
	};
}

function buildApp(configText = `[[repositories]]\nname = "${REPO}"\nclone = "/clone"\n`): App {
	const config = parseConfig(configText);
	const jobs = createJobRunner({
		store,
		concurrency: 2,
		abortPollMs: 5,
		handlers: {
			refresh: (context) => refreshHandler(context),
			thorough_assessment: () => Promise.resolve(),
			review_draft: () => Promise.resolve(),
		},
	});

	return {
		config,
		paths: resolvePaths({ homeDir: "/home", env: {}, platform: "darwin" }),
		store,
		github: {} as GitHubClient,
		worktrees: {} as WorktreeManager,
		codex: {} as CodexRunner,
		refresh: {
			runQuickAssessment: () => {
				quickAssessments += 1;
				return Promise.resolve(
					store.assessments.add(
						{
							repository: REPO,
							number: 1,
							depth: "quick",
							headSha: "sha",
							updatedAtSeen: NOW,
							verdict: verdict(),
						},
						NOW,
					),
				);
			},
		} as unknown as RefreshService,
		jobs,
		startRefresh: (repository) => jobs.enqueue({ kind: "refresh", repository }),
		startThoroughAssessment: (repository, number) =>
			jobs.enqueue({ kind: "thorough_assessment", repository, number }),
		startReviewDraft: (repository, number) =>
			jobs.enqueue({ kind: "review_draft", repository, number }),
		reloadConfig: () => Promise.resolve(config),
		close: () => jobs.shutdown(),
	};
}

function build(configText?: string): void {
	app = buildApp(configText);
	handlers = createHandlers(app, {
		openExternal,
		writeClipboard,
		dataChanged,
		now: () => NOW,
	});
}

beforeEach(() => {
	store = openStore(":memory:");
	openExternal = vi.fn<(url: string) => Promise<void>>().mockResolvedValue();
	writeClipboard = vi.fn<(text: string) => void>();
	dataChanged = vi.fn<(repository: string | null) => void>();
	quickAssessments = 0;
	refreshHandler = () => Promise.resolve();
	build();
});

afterEach(async () => {
	await app.close();
	store.close();
});

describe("listRepositories", () => {
	it("counts open pull requests, quick wins and unassessed ones", async () => {
		store.pullRequests.upsertMany([facts(1), facts(2), facts(3)], NOW);
		store.assessments.add(
			{
				repository: REPO,
				number: 1,
				depth: "quick",
				headSha: "sha",
				updatedAtSeen: NOW,
				verdict: verdict(),
			},
			NOW,
		);
		store.assessments.add(
			{
				repository: REPO,
				number: 2,
				depth: "quick",
				headSha: "sha",
				updatedAtSeen: NOW,
				verdict: null,
				error: "timed out",
			},
			NOW,
		);

		expect(await handlers.listRepositories()).toEqual([
			expect.objectContaining({
				name: REPO,
				owner: "owner",
				repo: "thing",
				clone: "/clone",
				open: 3,
				quickWins: 1,
				unassessed: 2,
				lastRefresh: null,
				runningJob: null,
			}),
		]);
	});

	it("shows the refresh job a repository is running", async () => {
		refreshHandler = ({ signal }) =>
			new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
		app.startRefresh(REPO);

		const [summary] = await handlers.listRepositories();

		expect(summary?.runningJob).toMatchObject({ kind: "refresh", state: "running" });
	});

	it("is empty before anything is tracked", async () => {
		build("");

		expect(await handlers.listRepositories()).toEqual([]);
	});
});

describe("listPullRequests", () => {
	beforeEach(() => {
		store.pullRequests.upsertMany([facts(1), facts(2)], NOW);
		store.pullRequests.closeMissing(REPO, [1], NOW);
	});

	it("hides closed pull requests by default", async () => {
		const rows = await handlers.listPullRequests({ repository: REPO });

		expect(rows.map((row) => row.pullRequest.number)).toEqual([1]);
	});

	it("includes them when asked", async () => {
		const rows = await handlers.listPullRequests({ repository: REPO, includeClosed: true });

		expect(rows).toHaveLength(2);
	});

	it("carries the derived fields, the note and the snooze", async () => {
		const assessment = store.assessments.add(
			{
				repository: REPO,
				number: 1,
				depth: "quick",
				headSha: "sha",
				updatedAtSeen: "2026-09-02T12:00:00.000Z",
				verdict: verdict(),
			},
			NOW,
		);
		store.notes.set({ repository: REPO, number: 1 }, "Ask about the API.", NOW);
		store.snoozes.untilAssessmentChanges({ repository: REPO, number: 1 }, assessment.id, NOW);

		const [row] = await handlers.listPullRequests({ repository: REPO });

		expect(row?.derived).toMatchObject({ quickWin: true, snoozed: true, unassessed: false });
		expect(row?.note?.text).toBe("Ask about the API.");
		expect(row?.assessment?.id).toBe(assessment.id);
	});
});

describe("getPullRequest", () => {
	beforeEach(() => {
		store.pullRequests.upsert(facts(1), NOW);
	});

	it("returns the assessment history and the review draft as markdown", async () => {
		store.assessments.add(
			{
				repository: REPO,
				number: 1,
				depth: "quick",
				headSha: "a",
				updatedAtSeen: NOW,
				verdict: verdict(),
			},
			NOW,
		);
		store.assessments.add(
			{
				repository: REPO,
				number: 1,
				depth: "thorough",
				headSha: "b",
				updatedAtSeen: NOW,
				verdict: verdict({ nextAction: "close" }),
			},
			NOW,
		);
		store.reviewDrafts.add(
			{
				repository: REPO,
				number: 1,
				headSha: "b",
				summary: "Two things to fix.",
				verdict: "request_changes",
				findings: [{ title: "Unchecked index", body: "Reads past the end.", severity: "blocker" }],
				sessionId: "session-1",
			},
			NOW,
		);

		const detail = await handlers.getPullRequest({ repository: REPO, number: 1 });

		expect(detail.history).toHaveLength(2);
		expect(detail.assessment?.depth).toBe("thorough");
		expect(detail.previousAssessment?.depth).toBe("quick");
		expect(detail.derived.changed).toEqual(["nextAction"]);
		expect(detail.reviewDraftMarkdown).toContain("### Blocker");
	});

	it("complains about a pull request it does not have", async () => {
		await expect(handlers.getPullRequest({ repository: REPO, number: 99 })).rejects.toThrow(
			/not in the database/,
		);
	});
});

describe("commands", () => {
	beforeEach(() => {
		store.pullRequests.upsert(facts(1), NOW);
	});

	it("starts a refresh and reports it as a job", async () => {
		const job = await handlers.refresh({ repository: REPO });

		expect(job).toMatchObject({ kind: "refresh", repository: REPO });
	});

	it("refreshes every repository, skipping any already running", async () => {
		build(`[[repositories]]\nname = "${REPO}"\n\n[[repositories]]\nname = "owner/other"\n`);
		refreshHandler = ({ signal }) =>
			new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
		app.startRefresh(REPO);

		const jobs = await handlers.refreshAll();

		expect(jobs.map((job) => job.repository)).toEqual(["owner/other"]);
	});

	it("aborts a job", async () => {
		refreshHandler = ({ signal }) =>
			new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
		const job = await handlers.refresh({ repository: REPO });

		expect(await handlers.abort({ id: job.id })).toBe(true);
	});

	it("runs a quick assessment and says the data changed", async () => {
		await handlers.assessQuick({ repository: REPO, number: 1 });

		expect(quickAssessments).toBe(1);
		expect(dataChanged).toHaveBeenCalledWith(REPO);
	});

	it("snoozes until the assessment is replaced", async () => {
		const assessment = store.assessments.add(
			{
				repository: REPO,
				number: 1,
				depth: "quick",
				headSha: "sha",
				updatedAtSeen: NOW,
				verdict: verdict(),
			},
			NOW,
		);

		await handlers.snooze({ repository: REPO, number: 1 });

		expect(store.snoozes.get({ repository: REPO, number: 1 })).toMatchObject({
			untilAssessmentId: assessment.id,
		});
	});

	it("snoozes until a date", async () => {
		await handlers.snooze({ repository: REPO, number: 1, until: "2026-09-20T00:00:00.000Z" });

		expect(store.snoozes.get({ repository: REPO, number: 1 })).toMatchObject({
			untilDate: "2026-09-20T00:00:00.000Z",
		});
	});

	it("refuses to snooze until change when there is nothing to change", async () => {
		await expect(handlers.snooze({ repository: REPO, number: 1 })).rejects.toThrow(/no assessment/);
	});

	it("clears a snooze", async () => {
		await handlers.snooze({ repository: REPO, number: 1, until: "2026-09-20T00:00:00.000Z" });

		await handlers.unsnooze({ repository: REPO, number: 1 });

		expect(store.snoozes.get({ repository: REPO, number: 1 })).toBeUndefined();
	});

	it("stores a note", async () => {
		await handlers.setNote({ repository: REPO, number: 1, text: "Ask about the API." });

		expect(store.notes.get({ repository: REPO, number: 1 })?.text).toBe("Ask about the API.");
		expect(dataChanged).toHaveBeenCalledWith(REPO);
	});
});

describe("copyToClipboard", () => {
	it("hands the text to the main process, which owns the clipboard", async () => {
		await handlers.copyToClipboard({ text: "**Approve** — looks good" });

		expect(writeClipboard).toHaveBeenCalledWith("**Approve** — looks good");
	});
});

describe("openOnGitHub", () => {
	it("opens a GitHub link", async () => {
		await handlers.openOnGitHub({ url: `https://github.com/${REPO}/pull/1` });

		expect(openExternal).toHaveBeenCalledWith(`https://github.com/${REPO}/pull/1`);
	});

	it.each(["https://example.test/evil", "file:///etc/passwd", "http://github.com/owner/thing"])(
		"refuses %s",
		async (url) => {
			await expect(handlers.openOnGitHub({ url })).rejects.toThrow();
			expect(openExternal).not.toHaveBeenCalled();
		},
	);
});
