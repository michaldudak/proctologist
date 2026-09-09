import { execFile } from "node:child_process";
import { mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorktreeManager, type RepositoryClone, type WorktreeManager } from "./worktrees.js";
import { findRemote } from "./remotes.js";

const run = promisify(execFile);

const REPO = "owner/thing";
const GIT_ENV = {
	...process.env,
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_SYSTEM: "/dev/null",
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.test",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.test",
};

let root: string;
let remote: string;
let target: RepositoryClone;
let manager: WorktreeManager;

async function git(cwd: string, ...args: string[]): Promise<string> {
	const { stdout } = await run("git", args, { cwd, env: GIT_ENV });
	return stdout.trim();
}

async function commit(cwd: string, file: string, contents: string): Promise<string> {
	await writeFile(path.join(cwd, file), contents, "utf8");
	await git(cwd, "add", file);
	await git(cwd, "commit", "-m", `Add ${file}`);
	return git(cwd, "rev-parse", "HEAD");
}

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "proctologist-git-"));
	remote = path.join(root, "remote.git");
	const seed = path.join(root, "seed");
	const clone = path.join(root, "clone");

	await git(root, "init", "--bare", "-b", "master", remote);
	await git(root, "init", "-b", "master", seed);
	await commit(seed, "readme.md", "hello\n");
	await git(seed, "remote", "add", "origin", remote);
	await git(seed, "push", "origin", "master");

	// A pull request head, exactly as GitHub exposes it.
	await git(seed, "checkout", "-b", "feature");
	const featureSha = await commit(seed, "feature.txt", "a change\n");
	await git(seed, "push", "origin", "feature");
	await git(remote, "update-ref", "refs/pull/1/head", featureSha);
	await git(remote, "update-ref", "-d", "refs/heads/feature");

	await git(root, "clone", remote, clone);
	// The clone looks like a GitHub clone, but fetches from the local bare repository.
	await git(clone, "remote", "set-url", "origin", "https://github.com/someone/fork.git");
	await git(clone, "remote", "add", "upstream", `https://github.com/${REPO}.git`);
	await git(clone, "config", `url.${remote}.insteadOf`, `https://github.com/${REPO}.git`);

	target = { repository: REPO, clone };
	manager = createWorktreeManager({ cacheDir: path.join(root, "cache"), env: GIT_ENV });
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("findRemote", () => {
	it("picks the remote whose URL matches the tracked repository", async () => {
		expect(await findRemote(target.clone, REPO, { env: GIT_ENV })).toMatchObject({
			name: "upstream",
		});
	});

	it("accepts a clone path written with a tilde, as a person would type it", async () => {
		vi.stubEnv("HOME", root);
		const relative = `~/${path.relative(root, target.clone)}`;

		expect(await findRemote(relative, REPO, { env: GIT_ENV })).toMatchObject({
			name: "upstream",
		});

		vi.unstubAllEnvs();
	});

	it("explains itself when no remote matches", async () => {
		await expect(findRemote(target.clone, "nobody/nothing", { env: GIT_ENV })).rejects.toThrow(
			/No remote .* points at nobody\/nothing/,
		);
	});
});

describe("defaultBranch", () => {
	it("asks the remote", async () => {
		expect(await manager.defaultBranch(target)).toBe("master");
	});
});

describe("defaultBranchWorktree", () => {
	it("creates a detached worktree at the remote head", async () => {
		const worktree = await manager.defaultBranchWorktree(target);

		expect(worktree.path).toBe(
			path.join(
				await realpath(path.join(root, "cache", "owner", "thing", "worktrees")),
				"proctologist-default",
			),
		);
		expect(await git(worktree.path, "rev-parse", "HEAD")).toBe(worktree.commit);
		expect(await git(worktree.path, "symbolic-ref", "-q", "HEAD").catch(() => "")).toBe("");
		expect(await readdir(worktree.path)).toContain("readme.md");
	});

	it("moves the existing worktree forward on the next refresh", async () => {
		const first = await manager.defaultBranchWorktree(target);
		const seed = path.join(root, "seed");
		await git(seed, "checkout", "master");
		const newHead = await commit(seed, "second.md", "more\n");
		await git(seed, "push", "origin", "master");

		const second = await manager.defaultBranchWorktree(target);

		expect(second.path).toBe(first.path);
		expect(second.commit).toBe(newHead);
		expect(await readdir(second.path)).toContain("second.md");
	});

	it("discards anything left in the worktree", async () => {
		const worktree = await manager.defaultBranchWorktree(target);
		await writeFile(path.join(worktree.path, "scratch.txt"), "junk\n", "utf8");

		await manager.defaultBranchWorktree(target);

		expect(await readdir(worktree.path)).not.toContain("scratch.txt");
	});
});

describe("pullHeadWorktree", () => {
	it("checks out the pull request head and cleans up on release", async () => {
		const worktree = await manager.pullHeadWorktree(target, 1);

		expect(path.basename(worktree.path)).toMatch(/^proctologist-pr-1-[0-9a-f]{8}$/);
		expect(await readdir(worktree.path)).toContain("feature.txt");
		expect(await git(worktree.path, "rev-parse", "HEAD")).toBe(worktree.commit);

		await worktree.release();
		await worktree.release();

		expect(await readdir(path.dirname(worktree.path))).not.toContain(path.basename(worktree.path));
	});

	it("gives two callers separate directories", async () => {
		const first = await manager.pullHeadWorktree(target, 1);
		const second = await manager.pullHeadWorktree(target, 1);

		expect(second.path).not.toBe(first.path);

		await first.release();
		await second.release();
	});

	it("fails clearly for a pull request that does not exist", async () => {
		await expect(manager.pullHeadWorktree(target, 99)).rejects.toThrow(/failed/);
	});
});

describe("prunePullHeadWorktrees", () => {
	it("removes leftover pull-head worktrees but keeps the default one", async () => {
		const defaultWorktree = await manager.defaultBranchWorktree(target);
		const leftover = await manager.pullHeadWorktree(target, 1);

		const removed = await manager.prunePullHeadWorktrees(target);

		expect(removed).toEqual([leftover.path]);
		const remaining = await readdir(path.dirname(defaultWorktree.path));
		expect(remaining).toEqual(["proctologist-default"]);
	});
});
