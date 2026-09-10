import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createGitHubClient, type GitHubClientOptions } from "./client.js";
import { GitHubError } from "./gh.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_GH = path.join(here, "__fixtures__", "fake-gh.mjs");
const FIXTURES = path.join(here, "__fixtures__");
const REPO = "owner/thing";

const temporaryDirs: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

function client(fixtureDir = FIXTURES, options: GitHubClientOptions = {}) {
	return createGitHubClient({
		ghPath: FAKE_GH,
		pageSize: 2,
		env: { ...process.env, FAKE_GH_DIR: fixtureDir },
		...options,
	});
}

async function failingFixtures(failure: { stderr?: string; stdout?: string; code?: number }) {
	const dir = await mkdtemp(path.join(os.tmpdir(), "proctologist-gh-"));
	temporaryDirs.push(dir);
	await writeFile(path.join(dir, "fail.json"), JSON.stringify(failure), "utf8");
	return dir;
}

describe("viewer", () => {
	it("reads the authenticated login", async () => {
		expect(await client().viewer()).toEqual({ login: "maintainer" });
	});
});

describe("defaultBranch", () => {
	it("reads the default branch name", async () => {
		expect(await client().defaultBranch(REPO)).toBe("master");
	});
});

describe("listOpenPullRequests", () => {
	it("follows pagination and skips null nodes", async () => {
		const facts = await client().listOpenPullRequests(REPO);

		expect(facts.map((pr) => pr.number)).toEqual([101, 102, 103]);
		expect(facts.every((pr) => pr.repository === REPO && pr.kind === "pull_request")).toBe(true);
	});

	it("maps the facts of a plain pull request", async () => {
		const [first] = await client().listOpenPullRequests(REPO);

		expect(first).toMatchObject({
			number: 101,
			title: "Fix the thing (101)",
			author: "contributor",
			isBot: false,
			authorAssociation: "CONTRIBUTOR",
			authoredByUser: false,
			reviewRequestedFromUser: true,
			isDraft: false,
			labels: ["bug"],
			baseRef: "master",
			additions: 12,
			deletions: 3,
			changedFiles: 2,
			mergeable: "MERGEABLE",
			reviewDecision: null,
			checks: { state: "passing", passed: 2, failed: 0, pending: 0 },
		});
	});

	it("recognises a bot author and a failing check rollup", async () => {
		const [, second] = await client().listOpenPullRequests(REPO);

		expect(second).toMatchObject({
			number: 102,
			isBot: true,
			authorAssociation: "NONE",
			isDraft: true,
			mergeable: "CONFLICTING",
			reviewDecision: "CHANGES_REQUESTED",
			checks: { state: "failing", passed: 1, failed: 1, pending: 1 },
		});
	});

	it("marks the viewer's own pull requests and copes with no checks", async () => {
		const [, , third] = await client().listOpenPullRequests(REPO);

		expect(third).toMatchObject({
			number: 103,
			author: "maintainer",
			authorAssociation: "MEMBER",
			authoredByUser: true,
			checks: { state: "none", passed: 0, failed: 0, pending: 0 },
		});
	});

	it("takes the last activity from the newest comment, review or commit", async () => {
		const [first, second] = await client().listOpenPullRequests(REPO);

		expect(first).toMatchObject({
			lastActivityAt: "2026-09-02T10:00:00Z",
			lastActivityBy: "contributor",
		});
		expect(second).toMatchObject({
			lastActivityAt: "2026-09-05T12:00:00Z",
			lastActivityBy: "maintainer",
		});
	});

	it("rejects a name that is not owner/name", async () => {
		await expect(client().listOpenPullRequests("thing")).rejects.toThrow(/owner\/name/);
	});
});

describe("pullRequestBundle", () => {
	it("gathers the body, discussion, files and diff", async () => {
		const bundle = await client().pullRequestBundle(REPO, 101);

		expect(bundle.facts.number).toBe(101);
		expect(bundle.body).toContain("Closes #99");
		expect(bundle.comments).toEqual([
			{
				author: "contributor",
				createdAt: "2026-09-02T10:00:00Z",
				body: "Any chance of a review?",
			},
		]);
		expect(bundle.reviews).toEqual([
			{
				author: "maintainer",
				state: "COMMENTED",
				submittedAt: "2026-09-03T08:00:00Z",
				body: "One question.",
			},
		]);
		expect(bundle.reviewThreads).toEqual([
			{
				path: "src/thing.ts",
				isResolved: false,
				isOutdated: false,
				comments: [
					{ author: "maintainer", createdAt: "2026-09-03T08:00:00Z", body: "Why the cast?" },
				],
			},
		]);
		expect(bundle.files.map((file) => file.path)).toEqual(["src/thing.ts", "src/thing.test.ts"]);
		expect(bundle.diff).toContain("diff --git");
		expect(bundle.diffOmittedReason).toBeNull();
	});

	it("leaves out a diff over the cut-off and says why", async () => {
		const bundle = await client().pullRequestBundle(REPO, 101, { diffCutoffKb: 0 });

		expect(bundle.diff).toBeNull();
		expect(bundle.diffOmittedReason).toMatch(/cut-off/);
		expect(bundle.files).not.toHaveLength(0);
	});
});

describe("errors", () => {
	it("reports a missing gh executable", async () => {
		const missing = createGitHubClient({ ghPath: path.join(os.tmpdir(), "no-such-gh") });

		await expect(missing.viewer()).rejects.toMatchObject({ kind: "not_installed" });
	});

	it("recognises an unauthenticated CLI", async () => {
		const dir = await failingFixtures({
			stderr: "To get started with GitHub CLI, please run: gh auth login\n",
		});

		await expect(client(dir).viewer()).rejects.toMatchObject({
			kind: "not_authenticated",
			exitCode: 1,
		});
	});

	it("recognises a rate limit", async () => {
		const dir = await failingFixtures({ stderr: "API rate limit exceeded for user\n" });

		await expect(client(dir).viewer()).rejects.toMatchObject({ kind: "rate_limited" });
	});

	it("recognises a repository it cannot see", async () => {
		const dir = await failingFixtures({
			stderr: "GraphQL: Could not resolve to a Repository with the name 'owner/thing'.\n",
		});

		await expect(client(dir).defaultBranch(REPO)).rejects.toMatchObject({ kind: "not_found" });
	});

	it("keeps anything else as a plain failure with the first line of stderr", async () => {
		const dir = await failingFixtures({ stderr: "something went wrong\nmore detail\n", code: 3 });

		await expect(client(dir).viewer()).rejects.toMatchObject({
			kind: "failed",
			exitCode: 3,
		});
		await expect(client(dir).viewer()).rejects.toThrow(/something went wrong/);
	});

	it("reports output that is not JSON", async () => {
		const dir = await failingFixtures({ stdout: "not json", code: 0 });

		await expect(client(dir).viewer()).rejects.toMatchObject({ kind: "invalid_output" });
	});

	it("is a GitHubError in every case", async () => {
		const dir = await failingFixtures({ stderr: "boom\n" });

		await expect(client(dir).viewer()).rejects.toBeInstanceOf(GitHubError);
	});
});
