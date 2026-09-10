import {
	createJobRunner,
	openStore,
	parseConfig,
	resolvePaths,
	type App,
	type AssessmentVerdict,
	type AgentRunner,
	type GitHubClient,
	type Job,
	type JobHandler,
	type PendingAssessment,
	type PullRequestFacts,
	type RefreshCandidate,
	type RefreshService,
	type Store,
	type WorktreeManager,
} from "@proctologist/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHandlers, type Handlers } from "./handlers.js";
import type { AppearanceMode } from "../shared/ipc.js";

const REPO = "owner/thing";
const NOW = "2026-09-09T12:00:00.000Z";

let store: Store;
let app: App;
let handlers: Handlers;
let openExternal: ReturnType<typeof vi.fn<(url: string) => Promise<void>>>;
let writeClipboard: ReturnType<typeof vi.fn<(text: string) => void>>;
let chooseFolder: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
let launchAtLogin: boolean;
let answers: { requestId: string; numbers: number[] | null }[];
let writeAppearance: ReturnType<typeof vi.fn<(mode: AppearanceMode) => void>>;
let dataChanged: ReturnType<typeof vi.fn<(repository: string | null) => void>>;
let refreshHandler: JobHandler;
let assessmentHandler: JobHandler;
let pending: PendingAssessment[];
/** What the fake app says is due, and what it was asked to assess. */
let due: RefreshCandidate[];
let dueRequests: { repository: string; full: boolean; confirm: boolean | undefined }[];

function verdict(overrides: Partial<AssessmentVerdict> = {}): AssessmentVerdict {
	return {
		nextAction: "merge",
		nextActionReason: "Approved and green.",
		area: "bug_fix",
		relevance: "still_relevant",
		relevanceReason: "r",
		status: "ready_to_merge",
		statusReason: "r",
		effort: "XS",
		effortReason: "r",
		priority: "medium",
		priorityReason: "r",
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

function candidate(number: number): RefreshCandidate {
	return {
		number,
		title: `Pull request ${String(number)}`,
		reason: "never",
		isBot: false,
		isDraft: false,
		authoredByUser: false,
		lastActivityAt: NOW,
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
			assessment: (context) => assessmentHandler(context),
			thorough_assessment: ({ signal }) =>
				new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
			review_draft: () => Promise.resolve(),
		},
	});
	const startAssessments = (repository: string, numbers: number[]): Job =>
		jobs.enqueue({
			kind: "assessment",
			repository,
			number: numbers.length === 1 ? (numbers[0] ?? null) : null,
			progress: { done: 0, total: numbers.length },
		});

	return {
		config,
		paths: resolvePaths({ homeDir: "/home", env: {}, platform: "darwin" }),
		store,
		github: {} as GitHubClient,
		worktrees: {} as WorktreeManager,
		agent: {} as AgentRunner,
		refresh: { dueAssessments: () => due } as unknown as RefreshService,
		jobs,
		startRefresh: (repository) => jobs.enqueue({ kind: "refresh", repository }),
		startDueAssessments: (repository, options = {}) => {
			dueRequests.push({ repository, full: options.full ?? false, confirm: options.confirm });
			return Promise.resolve(
				due.length > 0
					? startAssessments(
							repository,
							due.map((item) => item.number),
						)
					: null,
			);
		},
		startAssessments,
		startQuickAssessment: (repository, number) => startAssessments(repository, [number]),
		pendingAssessments: (repository) => (repository === REPO ? pending : []),
		startThoroughAssessment: (repository, number) =>
			jobs.enqueue({ kind: "thorough_assessment", repository, number }),
		startReviewDraft: (repository, number) =>
			jobs.enqueue({ kind: "review_draft", repository, number }),
		listAgentCatalogs: () => Promise.resolve({} as never),
		reloadConfig: () => Promise.resolve(config),
		close: () => jobs.shutdown(),
	};
}

function build(configText?: string): void {
	app = buildApp(configText);
	handlers = createHandlers(app, {
		openExternal,
		writeClipboard,
		chooseFolder,
		answerAssessments: (requestId, numbers) => answers.push({ requestId, numbers }),
		readLaunchAtLogin: () => launchAtLogin,
		writeLaunchAtLogin: (enabled) => {
			launchAtLogin = enabled;
		},
		writeAppearance,
		dataChanged,
		sessionStartedAt: NOW,
		now: () => NOW,
	});
}

beforeEach(() => {
	store = openStore(":memory:");
	openExternal = vi.fn<(url: string) => Promise<void>>().mockResolvedValue();
	writeClipboard = vi.fn<(text: string) => void>();
	chooseFolder = vi.fn<() => Promise<string | null>>().mockResolvedValue(null);
	launchAtLogin = false;
	answers = [];
	writeAppearance = vi.fn<(mode: AppearanceMode) => void>();
	dataChanged = vi.fn<(repository: string | null) => void>();
	pending = [];
	due = [];
	dueRequests = [];
	refreshHandler = () => Promise.resolve();
	assessmentHandler = () => Promise.resolve();
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
				due: 0,
				lastRefresh: null,
			}),
		]);
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
		const thorough = store.assessments.add(
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
		store.analyses.add(thorough.id, "## Background\n\nText.");
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
		expect(detail.analysis).toMatchObject({ assessmentId: thorough.id, headSha: "b" });
	});

	it("has no analysis until a thorough assessment writes one", async () => {
		const detail = await handlers.getPullRequest({ repository: REPO, number: 1 });

		expect(detail.analysis).toBeNull();
	});

	it("complains about a pull request it does not have", async () => {
		await expect(handlers.getPullRequest({ repository: REPO, number: 99 })).rejects.toThrow(
			/not in the database/,
		);
	});
});

describe("assessing", () => {
	beforeEach(() => {
		store.pullRequests.upsertMany([facts(1), facts(2), facts(3)], NOW);
	});

	it("marks the rows an assessment job is queued for or working on", async () => {
		pending = [
			{ number: 1, state: "running" },
			{ number: 2, state: "queued" },
		];

		const rows = await handlers.listPullRequests({ repository: REPO });

		expect(
			rows
				.toSorted((a, b) => a.pullRequest.number - b.pullRequest.number)
				.map((row) => row.assessing),
		).toEqual(["running", "queued", null]);
	});

	it("marks a row a thorough assessment is running for", async () => {
		app.startThoroughAssessment(REPO, 3);
		await new Promise((resolve) => setTimeout(resolve, 10));

		const rows = await handlers.listPullRequests({ repository: REPO });
		const detail = await handlers.getPullRequest({ repository: REPO, number: 3 });

		expect(rows.find((row) => row.pullRequest.number === 3)?.assessing).toBe("running");
		expect(rows.find((row) => row.pullRequest.number === 1)?.assessing).toBeNull();
		expect(detail.assessing).toBe("running");
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

	it("assesses what is due as one job, asking first", async () => {
		due = [candidate(1), candidate(2)];

		const job = await handlers.assessDue({ repository: REPO });

		expect(dueRequests).toEqual([{ repository: REPO, full: false, confirm: true }]);
		expect(job).toMatchObject({ kind: "assessment", number: null, progress: { total: 2 } });
	});

	it("asks for everything when told to assess in full", async () => {
		await handlers.assessDue({ repository: REPO, full: true });

		expect(dueRequests).toEqual([{ repository: REPO, full: true, confirm: true }]);
	});

	it("returns no job when nothing is due", async () => {
		expect(await handlers.assessDue({ repository: REPO })).toBeNull();
	});

	it("refreshes every repository, skipping any already running", async () => {
		build(`[[repositories]]\nname = "${REPO}"\n\n[[repositories]]\nname = "owner/other"\n`);
		refreshHandler = ({ signal }) =>
			new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
		app.startRefresh(REPO);

		const jobs = await handlers.refreshAll();

		expect(jobs.map((job) => job.repository)).toEqual(["owner/other"]);
	});

	it("passes the renderer's answer to the refresh waiting for it", async () => {
		await handlers.answerAssessments({ requestId: "q1", numbers: [1, 2] });

		expect(answers).toEqual([{ requestId: "q1", numbers: [1, 2] }]);
	});

	it("aborts a job", async () => {
		refreshHandler = ({ signal }) =>
			new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
		const job = await handlers.refresh({ repository: REPO });

		expect(await handlers.abort({ id: job.id })).toBe(true);
	});

	it("queues a quick assessment as a job about that pull request", async () => {
		const job = await handlers.assessQuick({ repository: REPO, number: 1 });

		expect(job).toMatchObject({ kind: "assessment", number: 1, progress: { total: 1 } });
	});

	it("lists only this session's jobs, newest first", async () => {
		store.jobs.create({ id: "old", kind: "refresh", repository: REPO }, "2026-09-01T00:00:00Z");
		store.jobs.finish("old", "completed", "2026-09-01T00:01:00Z");
		const first = await handlers.refresh({ repository: REPO });
		await app.jobs.wait(first.id);
		// Jobs are ordered by when they were created, which is only readable a clock tick apart.
		await new Promise((resolve) => setTimeout(resolve, 2));
		const second = await handlers.assessQuick({ repository: REPO, number: 1 });
		await app.jobs.wait(second.id);

		const jobs = await handlers.listJobs();

		expect(jobs.map((job) => job.id)).toEqual([second.id, first.id]);
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

describe("chooseCloneFolder", () => {
	it("hands the picker straight through", async () => {
		chooseFolder.mockResolvedValue("/Users/you/Projects/thing");

		expect(await handlers.chooseCloneFolder()).toBe("/Users/you/Projects/thing");
	});

	it("passes on a cancelled picker", async () => {
		expect(await handlers.chooseCloneFolder()).toBeNull();
	});
});

describe("checkRemote", () => {
	it("explains a folder with no matching remote instead of throwing", async () => {
		const result = await handlers.checkRemote({ repository: REPO, clone: "/nowhere" });

		expect(result.ok).toBe(false);
		expect(result.message).not.toBeNull();
	});
});

describe("launch at login", () => {
	it("reads and writes the operating system setting", async () => {
		expect(await handlers.getLaunchAtLogin()).toBe(false);

		await handlers.setLaunchAtLogin({ enabled: true });

		expect(await handlers.getLaunchAtLogin()).toBe(true);
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
