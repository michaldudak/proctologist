import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError, type AgentRunOptions, type AgentRunner } from "../agents/index.js";
import { parseConfig, type Config } from "../config/schema.js";
import type { WorktreeManager } from "../git/worktrees.js";
import type { GitHubClient, PullRequestBundle } from "../github/client.js";
import { openStore, type Store } from "../store/store.js";
import type { PullRequestFacts } from "../store/types.js";
import { createRefreshService, type RefreshService } from "./service.js";

const REPO = "owner/thing";

let store: Store;
let cacheDir: string;
let config: Config;
let service: RefreshService;
let agentRuns: AgentRunOptions[];
let agentOutput: (run: AgentRunOptions) => unknown;
let openPullRequests: PullRequestFacts[];
let listFails: Error | undefined;
let released: number;
let nowValue: string;

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
		createdAt: "2026-08-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
		isDraft: false,
		labels: [],
		headSha: `sha-${String(number)}`,
		baseRef: "master",
		additions: 1,
		deletions: 1,
		changedFiles: 1,
		mergeable: "MERGEABLE",
		reviewDecision: null,
		checks: { state: "passing", passed: 1, failed: 0, pending: 0 },
		lastActivityBy: "contributor",
		lastActivityAt: "2026-09-01T00:00:00.000Z",
		...overrides,
	};
}

function bundleFor(number: number): PullRequestBundle {
	return {
		facts: openPullRequests.find((item) => item.number === number) ?? facts(number),
		body: "body",
		comments: [],
		reviews: [],
		reviewThreads: [],
		files: [],
		diff: null,
		diffOmittedReason: null,
		filesTruncated: false,
	};
}

const validOutput = {
	next_action: "review",
	next_action_reason: "Nobody has looked at it.",
	area: "bug_fix",
	relevance: "still_relevant",
	relevance_reason: "The code is still there.",
	status: "waiting_on_maintainer",
	status_reason: "No review yet.",
	effort: "S",
	effort_reason: "Small.",
	summary: "Fixes a thing.",
	confidence: 0.6,
	evidence: [],
};

const github: GitHubClient = {
	viewer: () => Promise.resolve({ login: "maintainer" }),
	defaultBranch: () => Promise.resolve("master"),
	listOpenPullRequests: () =>
		listFails ? Promise.reject(listFails) : Promise.resolve(openPullRequests),
	pullRequestBundle: (_repository, number) => Promise.resolve(bundleFor(number)),
};

const worktrees: WorktreeManager = {
	remoteFor: () => Promise.resolve({ name: "upstream", url: "" }),
	defaultBranch: () => Promise.resolve("master"),
	defaultBranchWorktree: () => Promise.resolve({ path: "/worktrees/default", commit: "abc" }),
	pullHeadWorktree: (_target, number) =>
		Promise.resolve({
			path: `/worktrees/pr-${String(number)}`,
			commit: "def",
			release: () => {
				released += 1;
				return Promise.resolve();
			},
		}),
	prunePullHeadWorktrees: () => Promise.resolve([]),
};

const agentRunner: AgentRunner = {
	run: async <T>(run: AgentRunOptions) => {
		agentRuns.push(run);
		const output = agentOutput(run);
		if (output instanceof Error) {
			throw output;
		}
		return {
			output: output as T,
			agent: run.profile.agent,
			sessionId: null,
			logPath: "/logs/run.log",
			durationMs: 1,
			model: run.profile.model ?? null,
			commands: [],
			usage: null,
		};
	},
};

function build(configText = `[[repositories]]\nname = "${REPO}"\nclone = "/clone"\n`): void {
	config = parseConfig(configText);
	service = createRefreshService({
		store,
		github,
		worktrees,
		agent: agentRunner,
		cacheDir,
		config: () => config,
		now: () => nowValue,
	});
}

beforeEach(async () => {
	store = openStore(":memory:");
	cacheDir = await mkdtemp(path.join(os.tmpdir(), "proctologist-refresh-"));
	agentRuns = [];
	agentOutput = () => validOutput;
	openPullRequests = [facts(1), facts(2)];
	listFails = undefined;
	released = 0;
	nowValue = "2026-09-09T12:00:00.000Z";
	build();
});

afterEach(async () => {
	store.close();
	await rm(cacheDir, { recursive: true, force: true });
});

/** Fetches, then assesses everything due: what a refresh followed by "assess due" does. */
async function refreshAndAssess(): Promise<void> {
	await service.runRefresh(REPO);
	await service.runAssessments(
		REPO,
		service.dueAssessments(REPO).map((candidate) => candidate.number),
	);
}

describe("runRefresh", () => {
	it("stores the pull requests and counts every one of them as due the first time", async () => {
		const refresh = await service.runRefresh(REPO);

		expect(refresh).toMatchObject({
			outcome: "completed",
			counts: { fetched: 2, added: 2, changed: 0, closed: 0, due: 2 },
		});
		expect(store.pullRequests.list(REPO)).toHaveLength(2);
		expect(agentRuns).toEqual([]);
	});

	it("counts nothing due on a second run when nothing changed", async () => {
		await refreshAndAssess();

		const refresh = await service.runRefresh(REPO);

		expect(refresh.counts).toMatchObject({ fetched: 2, added: 0, changed: 0, due: 0 });
	});

	it("counts a pull request whose head moved as changed and due", async () => {
		await refreshAndAssess();
		openPullRequests = [facts(1, { headSha: "sha-1-new" }), facts(2)];

		const refresh = await service.runRefresh(REPO);

		expect(refresh.counts).toMatchObject({ changed: 1, due: 1 });
	});

	it("closes pull requests that are no longer open", async () => {
		await service.runRefresh(REPO);
		openPullRequests = [facts(1)];

		const refresh = await service.runRefresh(REPO);

		expect(refresh.counts.closed).toBe(1);
		expect(store.pullRequests.get({ repository: REPO, number: 2 })?.closedAt).not.toBeNull();
		expect(store.pullRequests.list(REPO)).toHaveLength(1);
	});

	it("reports the pull requests as soon as they are stored, before the record is written", async () => {
		let storedWhenFetched = 0;
		let recordedWhenFetched: unknown;

		await service.runRefresh(REPO, {
			onFetched: () => {
				storedWhenFetched = store.pullRequests.list(REPO).length;
				recordedWhenFetched = store.refreshes.latest(REPO);
			},
		});

		expect(storedWhenFetched).toBe(2);
		expect(recordedWhenFetched).toBeUndefined();
	});

	it("fails as a whole when the pull requests cannot be listed", async () => {
		await service.runRefresh(REPO);
		listFails = new Error("GitHub is down");

		const refresh = await service.runRefresh(REPO);

		expect(refresh).toMatchObject({ outcome: "failed", error: "GitHub is down" });
		expect(store.pullRequests.list(REPO)).toHaveLength(2);
	});

	it("records a refresh stopped while fetching as aborted, not failed", async () => {
		const controller = new AbortController();
		controller.abort();
		listFails = new Error("The operation was aborted");

		const refresh = await service.runRefresh(REPO, { signal: controller.signal });

		expect(refresh).toMatchObject({ outcome: "aborted", error: null });
	});

	it("purges pull requests closed longer ago than the retention window", async () => {
		await service.runRefresh(REPO);
		openPullRequests = [facts(1)];
		await service.runRefresh(REPO);

		expect(store.pullRequests.list(REPO, { includeClosed: true })).toHaveLength(2);

		nowValue = "2026-11-09T12:00:00.000Z";
		await service.runRefresh(REPO);

		expect(store.pullRequests.list(REPO, { includeClosed: true }).map((pr) => pr.number)).toEqual([
			1,
		]);
	});

	it("refuses a repository that is not tracked", async () => {
		await expect(service.runRefresh("nobody/nothing")).rejects.toThrow(/not a tracked/);
	});
});

describe("dueAssessments", () => {
	it("lists every pull request, with why, when none has been assessed", async () => {
		await service.runRefresh(REPO);

		expect(service.dueAssessments(REPO)).toEqual([
			expect.objectContaining({ number: 1, reason: "never", isBot: false, isDraft: false }),
			expect.objectContaining({ number: 2, reason: "never" }),
		]);
	});

	it("lists nothing once everything has been assessed", async () => {
		await refreshAndAssess();

		expect(service.dueAssessments(REPO)).toEqual([]);
	});

	it("lists a pull request whose head moved since its assessment, and says why", async () => {
		await refreshAndAssess();
		openPullRequests = [facts(1, { headSha: "sha-1-new" }), facts(2)];
		await service.runRefresh(REPO);

		expect(service.dueAssessments(REPO)).toEqual([
			expect.objectContaining({ number: 1, reason: "changed" }),
		]);
	});

	it("lists everything when asked for a full re-assessment", async () => {
		await refreshAndAssess();

		expect(service.dueAssessments(REPO, { full: true }).map((item) => item.number)).toEqual([1, 2]);
	});

	it("refuses a repository that is not tracked", () => {
		expect(() => service.dueAssessments("owner/untracked")).toThrow(/not a tracked repository/);
	});
});

describe("runAssessments", () => {
	beforeEach(async () => {
		await service.runRefresh(REPO);
	});

	it("assesses each pull request and counts the verdicts", async () => {
		const batch = await service.runAssessments(REPO, [1, 2]);

		expect(batch).toEqual({ assessed: 2, unassessed: 0, skipped: 0 });
		expect(store.assessments.current({ repository: REPO, number: 1 })?.verdict?.nextAction).toBe(
			"review",
		);
		expect(agentRuns).toHaveLength(2);
	});

	it("does nothing when given nothing", async () => {
		const batch = await service.runAssessments(REPO, []);

		expect(batch).toEqual({ assessed: 0, unassessed: 0, skipped: 0 });
		expect(agentRuns).toEqual([]);
	});

	it("retries once when the agent returns something invalid, then records it as unassessed", async () => {
		agentOutput = () => ({ next_action: "nonsense" });

		const batch = await service.runAssessments(REPO, [1, 2]);

		expect(agentRuns).toHaveLength(4);
		expect(
			agentRuns.filter((run) => run.prompt.includes("previous-attempt-rejected")),
		).toHaveLength(2);
		expect(batch).toMatchObject({ assessed: 0, unassessed: 2 });
		expect(store.assessments.current({ repository: REPO, number: 1 })).toMatchObject({
			verdict: null,
		});
	});

	it("accepts a valid reply on the retry", async () => {
		let first = true;
		agentOutput = () => {
			if (first) {
				first = false;
				return {};
			}
			return validOutput;
		};

		const batch = await service.runAssessments(REPO, [1, 2]);

		expect(batch).toMatchObject({ assessed: 2, unassessed: 0 });
	});

	it("records an agent failure as an unassessed pull request", async () => {
		agentOutput = () =>
			new AgentError("timeout", "Codex did not finish.", { agent: "codex", logPath: "/l" });

		const batch = await service.runAssessments(REPO, [1, 2]);

		expect(batch.unassessed).toBe(2);
		expect(store.assessments.current({ repository: REPO, number: 1 })?.error).toContain(
			"did not finish",
		);
	});

	it("keeps finished assessments when the run is stopped, and skips the rest", async () => {
		const controller = new AbortController();
		agentOutput = (run) => {
			if (run.label.endsWith("-2")) {
				controller.abort();
				return new AgentError("aborted", "Codex was stopped.", { agent: "codex", logPath: "" });
			}
			return validOutput;
		};
		// One at a time, so the stop lands between pull requests rather than while all are in flight.
		config = { ...config, concurrency: 1 };

		const batch = await service.runAssessments(REPO, [1, 2, 3], { signal: controller.signal });

		expect(batch).toEqual({ assessed: 1, unassessed: 0, skipped: 2 });
		expect(store.assessments.current({ repository: REPO, number: 1 })).toBeDefined();
		expect(store.assessments.current({ repository: REPO, number: 3 })).toBeUndefined();
	});

	it("reports progress as pull requests are assessed", async () => {
		const onProgress = vi.fn();

		await service.runAssessments(REPO, [1, 2], { onProgress });

		expect(onProgress.mock.calls[0]?.[0]).toMatchObject({ done: 0, total: 2 });
		expect(onProgress.mock.lastCall?.[0]).toMatchObject({
			done: 2,
			total: 2,
			failed: 0,
			label: "Assessed 2 of 2",
		});
	});

	it("says when each pull request starts and finishes", async () => {
		const seen: string[] = [];

		await service.runAssessments(REPO, [1, 2], {
			onItem: (number, stage) => seen.push(`${String(number)}:${stage}`),
		});

		expect(seen.toSorted()).toEqual(["1:done", "1:running", "2:done", "2:running"]);
	});

	it("runs the agent read-only in the default-branch worktree", async () => {
		await service.runAssessments(REPO, [1]);

		expect(agentRuns[0]).toMatchObject({ sandbox: "read-only", cwd: "/worktrees/default" });
		expect(agentRuns[0]?.prompt).toContain("worktree already checked out");
	});

	it("uses a scratch folder and says so when no clone is configured", async () => {
		build(`[[repositories]]\nname = "${REPO}"\n`);

		await service.runAssessments(REPO, [1]);

		expect(agentRuns[0]?.cwd).toBe(path.join(cacheDir, "owner", "thing", "scratch"));
		expect(agentRuns[0]?.prompt).toContain("Your working directory is empty");
	});

	it("passes the repository's context and its profile overrides to the agent", async () => {
		build(
			`[[repositories]]\nname = "${REPO}"\nclone = "/clone"\ncontext = "A component library."\n\n[repositories.profiles.assess]\ntimeout_minutes = 9\n`,
		);

		await service.runAssessments(REPO, [1]);

		expect(agentRuns[0]?.prompt).toContain("A component library.");
		expect(agentRuns[0]?.profile.timeoutMinutes).toBe(9);
	});
});

describe("runQuickAssessment", () => {
	it("records the pull request first, so it works before any refresh has run", async () => {
		const assessment = await service.runQuickAssessment(REPO, 1);

		expect(store.pullRequests.get({ repository: REPO, number: 1 })?.title).toBe("Pull request 1");
		expect(assessment.verdict?.nextAction).toBe("review");
	});

	it("re-assesses one pull request in the default-branch worktree", async () => {
		await refreshAndAssess();
		agentRuns = [];

		const assessment = await service.runQuickAssessment(REPO, 1);

		expect(assessment.depth).toBe("quick");
		expect(agentRuns).toHaveLength(1);
		expect(agentRuns[0]).toMatchObject({ sandbox: "read-only", cwd: "/worktrees/default" });
		expect(store.assessments.history({ repository: REPO, number: 1 })).toHaveLength(2);
	});
});

describe("runReviewDraft", () => {
	const reviewOutput = {
		summary: "Two things to fix.",
		verdict: "request_changes",
		findings: [
			{
				title: "Unchecked index",
				body: "Reads past the end.",
				severity: "blocker",
				path: "a.ts",
				line: null,
			},
		],
	};

	beforeEach(async () => {
		await refreshAndAssess();
		agentRuns = [];
		agentOutput = () => reviewOutput;
	});

	it("works before any refresh has recorded the pull request", async () => {
		store = openStore(":memory:");
		build();
		agentOutput = () => reviewOutput;

		const draft = await service.runReviewDraft(REPO, 1);

		expect(draft.verdict).toBe("request_changes");
	});

	it("runs in a pull-head worktree, keeps the session and stores the draft", async () => {
		const draft = await service.runReviewDraft(REPO, 1);

		expect(agentRuns[0]).toMatchObject({
			sandbox: "workspace-write",
			cwd: "/worktrees/pr-1",
			ephemeral: false,
		});
		expect(draft.findings).toHaveLength(1);
		expect(store.reviewDrafts.latest({ repository: REPO, number: 1 })?.verdict).toBe(
			"request_changes",
		);
		expect(released).toBe(1);
	});

	it("uses the repository's review instructions and the effort asked for", async () => {
		build(
			`[[repositories]]\nname = "${REPO}"\nclone = "/clone"\nreview_instructions = "Use the house skill."\n`,
		);

		await service.runReviewDraft(REPO, 1, { effort: "low" });

		expect(agentRuns[0]?.prompt).toContain("Use the house skill.");
		expect(agentRuns[0]?.profile.effort).toBe("low");
	});

	it("refuses a reply that does not match the schema, and still frees the worktree", async () => {
		agentOutput = () => ({ verdict: "lgtm" });

		await expect(service.runReviewDraft(REPO, 1)).rejects.toThrow(/did not match the schema/);
		expect(released).toBe(1);
	});

	it("needs a local clone", async () => {
		build(`[[repositories]]\nname = "${REPO}"\n`);

		await expect(service.runReviewDraft(REPO, 1)).rejects.toThrow(/needs a local clone/);
	});
});

describe("runThoroughAssessment", () => {
	beforeEach(async () => {
		await refreshAndAssess();
		agentRuns = [];
	});

	it("runs in a pull-head worktree with the workspace-write sandbox", async () => {
		const assessment = await service.runThoroughAssessment(REPO, 1);

		expect(agentRuns[0]).toMatchObject({
			sandbox: "workspace-write",
			cwd: "/worktrees/pr-1",
		});
		expect(agentRuns[0]?.profile.timeoutMinutes).toBe(config.profiles.thorough.timeoutMinutes);
		expect(assessment.depth).toBe("thorough");
		expect(store.assessments.current({ repository: REPO, number: 1 })?.depth).toBe("thorough");
	});

	it("releases the worktree even when the agent fails", async () => {
		agentOutput = () => new AgentError("failed", "boom", { agent: "codex", logPath: "" });

		await service.runThoroughAssessment(REPO, 1);

		expect(released).toBe(1);
	});

	it("needs a local clone", async () => {
		build(`[[repositories]]\nname = "${REPO}"\n`);

		await expect(service.runThoroughAssessment(REPO, 1)).rejects.toThrow(/needs a local clone/);
	});
});
