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
	type RefreshService,
	type Store,
	type WorktreeManager,
} from "@proctologist/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_FAILED, EXIT_OK, EXIT_USAGE, run } from "./cli.js";

const REPO = "owner/thing";
const NOW = "2026-09-09T12:00:00.000Z";

let store: Store;
let app: App;
let out: string[];
let err: string[];
let refreshHandler: JobHandler;
let assessmentHandler: JobHandler;
let thoroughHandler: JobHandler;
let reviewHandler: JobHandler;

function verdict(overrides: Partial<AssessmentVerdict> = {}): AssessmentVerdict {
	return {
		nextAction: "merge",
		nextActionReason: "It is approved and green.",
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

function seedPullRequest(number: number): void {
	store.pullRequests.upsert(
		{
			repository: REPO,
			kind: "pull_request",
			number,
			title: `Pull request ${number}`,
			url: `https://github.com/${REPO}/pull/${number}`,
			author: "contributor",
			isBot: false,
			authoredByUser: false,
			reviewRequestedFromUser: false,
			createdAt: NOW,
			updatedAt: NOW,
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
			lastActivityAt: NOW,
		},
		NOW,
	);
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
			thorough_assessment: (context) => thoroughHandler(context),
			review_draft: (context) => reviewHandler(context),
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
		refresh: {} as RefreshService,
		jobs,
		startRefresh: (repository) => jobs.enqueue({ kind: "refresh", repository }),
		startAssessments,
		startQuickAssessment: (repository, number) => startAssessments(repository, [number]),
		pendingAssessments: () => [],
		startThoroughAssessment: (repository, number) =>
			jobs.enqueue({ kind: "thorough_assessment", repository, number }),
		startReviewDraft: (repository, number) =>
			jobs.enqueue({ kind: "review_draft", repository, number }),
		listAgentCatalogs: () => Promise.resolve({} as never),
		reloadConfig: () => Promise.resolve(config),
		close: () => jobs.shutdown(),
	};
}

async function cli(...argv: string[]): Promise<number> {
	return run({
		argv,
		stdout: { write: (text) => out.push(text) },
		stderr: { write: (text) => err.push(text) },
		openApp: () => Promise.resolve(app),
	});
}

beforeEach(() => {
	store = openStore(":memory:");
	out = [];
	err = [];
	// A refresh that finds one pull request due, then queues the job that assesses it.
	refreshHandler = ({ job, setProgress }) => {
		setProgress({ done: 1, total: 1, label: "Fetched 3 pull requests" });
		store.refreshes.record({
			repository: REPO,
			startedAt: NOW,
			finishedAt: NOW,
			outcome: "completed",
			counts: { fetched: 3, added: 1, changed: 1, closed: 2, due: 1 },
		});
		app.jobs.enqueue({
			kind: "assessment",
			repository: job.repository,
			parentId: job.id,
			progress: { done: 0, total: 1 },
		});
		return Promise.resolve();
	};
	assessmentHandler = ({ setProgress }) => {
		seedPullRequest(1);
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
		setProgress({ done: 1, total: 1, failed: 0, label: "Assessed 1 of 1" });
		return Promise.resolve();
	};
	thoroughHandler = () => Promise.resolve();
	reviewHandler = () => {
		store.reviewDrafts.add(
			{
				repository: REPO,
				number: 1,
				headSha: "sha",
				summary: "Looks close, two things to fix.",
				verdict: "request_changes",
				findings: [
					{
						title: "Unchecked index",
						body: "The loop can read past the end.",
						severity: "blocker",
						path: "src/thing.ts",
						line: 12,
					},
				],
				sessionId: "session-1",
			},
			NOW,
		);
		return Promise.resolve();
	};
	app = buildApp();
});

afterEach(async () => {
	await app.close();
	store.close();
});

describe("usage", () => {
	it("prints help and succeeds when asked", async () => {
		expect(await cli("--help")).toBe(EXIT_OK);
		expect(out.join("")).toContain("proctologist refresh");
	});

	it("prints help and reports a usage error with no command", async () => {
		expect(await cli()).toBe(EXIT_USAGE);
	});

	it("rejects an unknown command", async () => {
		expect(await cli("frobnicate")).toBe(EXIT_USAGE);
		expect(err.join("")).toContain("Unknown command");
	});

	it("rejects an unknown option", async () => {
		expect(await cli("refresh", "--nope")).toBe(EXIT_USAGE);
	});
});

describe("refresh", () => {
	it("runs a refresh and reports the counts", async () => {
		expect(await cli("refresh", REPO)).toBe(EXIT_OK);

		expect(out.join("")).toContain(`${REPO}: completed (3 open, 1 new, 2 closed, 1 to assess)`);
		expect(out.join("")).toContain(`${REPO}: assessment completed (1 assessed, 0 unassessed)`);
	});

	it("reports the progress of the refresh and of its assessment on stderr", async () => {
		await cli("refresh", REPO);

		expect(err.join("")).toContain("Fetched 3 pull requests");
		expect(err.join("")).toContain("Assessed 1 of 1");
		expect(out.join("")).not.toContain("Assessed 1 of 1");
	});

	it("fails when the assessment the refresh queued fails", async () => {
		assessmentHandler = () => Promise.reject(new Error("The agent is not installed"));

		expect(await cli("refresh", REPO)).toBe(EXIT_FAILED);
		expect(out.join("")).toContain("assessment failed — The agent is not installed");
	});

	it("reports a refresh that found nothing to assess without waiting for anything", async () => {
		refreshHandler = () => {
			store.refreshes.record({
				repository: REPO,
				startedAt: NOW,
				finishedAt: NOW,
				outcome: "completed",
				counts: { fetched: 3, added: 0, changed: 0, closed: 0, due: 0 },
			});
			return Promise.resolve();
		};

		expect(await cli("refresh", REPO)).toBe(EXIT_OK);
		expect(out.join("")).toContain("0 to assess");
		expect(out.join("")).not.toContain("assessment");
	});

	it("needs a repository or --all", async () => {
		expect(await cli("refresh")).toBe(EXIT_USAGE);
	});

	it("refreshes every tracked repository with --all", async () => {
		app = buildApp(
			`[[repositories]]\nname = "${REPO}"\n\n[[repositories]]\nname = "owner/other"\n`,
		);

		expect(await cli("refresh", "--all")).toBe(EXIT_OK);

		expect(out.join("")).toContain(`${REPO}: completed`);
		expect(out.join("")).toContain("owner/other: completed");
	});

	it("says so when nothing is tracked", async () => {
		app = buildApp("");

		expect(await cli("refresh", "--all")).toBe(EXIT_FAILED);
		expect(err.join("")).toContain("No repositories are tracked");
	});

	it("fails when the refresh job fails", async () => {
		refreshHandler = () => Promise.reject(new Error("GitHub is down"));

		expect(await cli("refresh", REPO)).toBe(EXIT_FAILED);
		expect(out.join("")).toContain("failed — GitHub is down");
	});

	it("fails when the refresh itself could not list the pull requests", async () => {
		refreshHandler = () => {
			store.refreshes.record({
				repository: REPO,
				startedAt: NOW,
				finishedAt: NOW,
				outcome: "failed",
				counts: { fetched: 0, added: 0, changed: 0, closed: 0, due: 0 },
				error: "gh is not on PATH",
			});
			return Promise.reject(new Error("gh is not on PATH"));
		};

		expect(await cli("refresh", REPO)).toBe(EXIT_FAILED);
		expect(out.join("")).toContain("gh is not on PATH");
	});
});

describe("assess", () => {
	beforeEach(() => {
		seedPullRequest(1);
	});

	it("runs a quick assessment and prints the verdict", async () => {
		expect(await cli("assess", REPO, "1")).toBe(EXIT_OK);

		const text = out.join("");
		expect(text).toContain(`${REPO}#1: Merge (quick win)`);
		expect(text).toContain("Fixes an off-by-one.");
		expect(text).toContain("effort XS");
	});

	it("runs a thorough assessment through a job", async () => {
		thoroughHandler = () => {
			store.assessments.add(
				{
					repository: REPO,
					number: 1,
					depth: "thorough",
					headSha: "sha",
					updatedAtSeen: NOW,
					verdict: verdict({ nextAction: "close", effort: "L" }),
				},
				NOW,
			);
			return Promise.resolve();
		};

		expect(await cli("assess", REPO, "1", "--thorough")).toBe(EXIT_OK);
		expect(out.join("")).toContain(`${REPO}#1: Close`);
		expect(out.join("")).not.toContain("quick win");
	});

	it("reports an unassessed pull request as a failure", async () => {
		assessmentHandler = () => {
			store.assessments.add(
				{
					repository: REPO,
					number: 1,
					depth: "quick",
					headSha: "sha",
					updatedAtSeen: NOW,
					verdict: null,
					error: "The agent timed out",
				},
				NOW,
			);
			return Promise.resolve();
		};

		expect(await cli("assess", REPO, "1")).toBe(EXIT_FAILED);
		expect(out.join("")).toContain("unassessed — The agent timed out");
	});

	it("needs a repository and a number", async () => {
		expect(await cli("assess", REPO)).toBe(EXIT_USAGE);
		expect(await cli("assess", REPO, "zero")).toBe(EXIT_USAGE);
	});
});

describe("review", () => {
	beforeEach(() => {
		seedPullRequest(1);
	});

	it("drafts a review and prints it as markdown", async () => {
		expect(await cli("review", REPO, "1")).toBe(EXIT_OK);

		const text = out.join("");
		expect(text).toContain("**Request changes** — Looks close, two things to fix.");
		expect(text).toContain("### Blocker");
		expect(text).toContain("`src/thing.ts:12`");
	});

	it("rejects an effort that is not shaped like a reasoning level", async () => {
		expect(await cli("review", REPO, "1", "--effort", "Very High!")).toBe(EXIT_USAGE);
	});

	it("accepts a level it has never heard of, because the agent decides which exist", async () => {
		expect(await cli("review", REPO, "1", "--effort", "ultra")).toBe(EXIT_OK);
	});

	it("needs a repository and a number", async () => {
		expect(await cli("review", REPO)).toBe(EXIT_USAGE);
	});

	it("fails when the job fails", async () => {
		reviewHandler = () => Promise.reject(new Error("The agent timed out"));

		expect(await cli("review", REPO, "1")).toBe(EXIT_FAILED);
		expect(err.join("")).toContain("The agent timed out");
	});
});

describe("jobs", () => {
	it("says when nothing is running", async () => {
		expect(await cli("jobs")).toBe(EXIT_OK);
		expect(out.join("")).toContain("Nothing is running");
	});

	it("lists finished jobs with --all", async () => {
		await cli("refresh", REPO);
		out = [];

		expect(await cli("jobs", "--all")).toBe(EXIT_OK);
		expect(out.join("")).toContain("refresh");
		expect(out.join("")).toContain("completed");
	});
});

describe("abort", () => {
	it("stops a running job", async () => {
		refreshHandler = ({ signal }) =>
			new Promise((resolve) => {
				signal.addEventListener("abort", () => resolve(), { once: true });
			});
		const job = app.startRefresh(REPO);

		expect(await cli("abort", job.id)).toBe(EXIT_OK);
		expect(out.join("")).toContain("Asked job");
	});

	it("reports an id it cannot find", async () => {
		expect(await cli("abort", "no-such-job")).toBe(EXIT_FAILED);
	});

	it("needs an id", async () => {
		expect(await cli("abort")).toBe(EXIT_USAGE);
	});
});

describe("repositories", () => {
	it("lists what is tracked with counts", async () => {
		seedPullRequest(1);
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

		expect(await cli("repositories")).toBe(EXIT_OK);
		expect(out.join("")).toContain(`${REPO}  1 open  1 quick wins`);
	});

	it("points at the config file when nothing is tracked", async () => {
		app = buildApp("");

		expect(await cli("repositories")).toBe(EXIT_OK);
		expect(out.join("")).toContain("config.toml");
	});

	it("marks a repository with no local clone", async () => {
		app = buildApp(`[[repositories]]\nname = "${REPO}"\n`);

		await cli("repositories");
		expect(out.join("")).toContain("(no local clone)");
	});
});

describe("failures", () => {
	it("reports a config that cannot be read", async () => {
		const failing = await run({
			argv: ["jobs"],
			stdout: { write: (text) => out.push(text) },
			stderr: { write: (text) => err.push(text) },
			openApp: () => Promise.reject(new Error("The config file is broken")),
		});

		expect(failing).toBe(EXIT_FAILED);
		expect(err.join("")).toContain("The config file is broken");
	});

	it("closes the app even when a command throws", async () => {
		const close = vi.fn(() => Promise.resolve());
		app = { ...buildApp(), close };
		refreshHandler = () => Promise.resolve();

		await cli("refresh", REPO);

		expect(close).toHaveBeenCalledOnce();
	});
});
