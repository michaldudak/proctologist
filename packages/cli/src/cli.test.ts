import {
	createJobRunner,
	openStore,
	parseConfig,
	resolvePaths,
	type App,
	type Assessment,
	type AssessmentVerdict,
	type CodexRunner,
	type GitHubClient,
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
let thoroughHandler: JobHandler;
let quickAssessment: () => Promise<Assessment>;

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
			thorough_assessment: (context) => thoroughHandler(context),
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
			runRefresh: () => {
				throw new Error("not used");
			},
			runQuickAssessment: () => quickAssessment(),
			runThoroughAssessment: () => {
				throw new Error("not used");
			},
		} as unknown as RefreshService,
		jobs,
		startRefresh: (repository) => jobs.enqueue({ kind: "refresh", repository }),
		startThoroughAssessment: (repository, number) =>
			jobs.enqueue({ kind: "thorough_assessment", repository, number }),
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
	refreshHandler = ({ setProgress }) => {
		setProgress({ done: 1, total: 1, label: "Assessed 1 of 1" });
		store.refreshes.record({
			repository: REPO,
			startedAt: NOW,
			finishedAt: NOW,
			outcome: "completed",
			counts: { fetched: 3, added: 1, changed: 1, reassessed: 1, unassessed: 0, closed: 2 },
		});
		return Promise.resolve();
	};
	thoroughHandler = () => Promise.resolve();
	quickAssessment = () =>
		Promise.resolve(
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

		expect(out.join("")).toContain(
			`${REPO}: completed (3 open, 1 new, 1 assessed, 0 unassessed, 2 closed)`,
		);
	});

	it("reports progress on stderr", async () => {
		await cli("refresh", REPO);

		expect(err.join("")).toContain("Assessed 1 of 1");
		expect(out.join("")).not.toContain("Assessed 1 of 1");
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
		quickAssessment = () =>
			Promise.resolve(
				store.assessments.add(
					{
						repository: REPO,
						number: 1,
						depth: "quick",
						headSha: "sha",
						updatedAtSeen: NOW,
						verdict: null,
						error: "Codex timed out",
					},
					NOW,
				),
			);

		expect(await cli("assess", REPO, "1")).toBe(EXIT_FAILED);
		expect(out.join("")).toContain("unassessed — Codex timed out");
	});

	it("needs a repository and a number", async () => {
		expect(await cli("assess", REPO)).toBe(EXIT_USAGE);
		expect(await cli("assess", REPO, "zero")).toBe(EXIT_USAGE);
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
