import { randomBytes } from "node:crypto";
import { mkdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { repositoryCacheDir } from "../config/paths.js";
import { GitError, runGit, type GitOptions } from "./git.js";
import { findRemote, type Remote } from "./remotes.js";

/** A tracked repository together with the local clone used as its object store (ADR 0001). */
export interface RepositoryClone {
	repository: string;
	clone: string;
}

export interface Worktree {
	path: string;
	commit: string;
}

export interface LeasedWorktree extends Worktree {
	/** Removes the worktree. Safe to call twice. */
	release: () => Promise<void>;
}

export interface WorktreeManagerOptions extends GitOptions {
	/** Root of the app's cache; worktrees live under `<cacheDir>/<owner>/<name>/worktrees`. */
	cacheDir: string;
}

export interface WorktreeManager {
	remoteFor: (target: RepositoryClone) => Promise<Remote>;
	defaultBranch: (target: RepositoryClone) => Promise<string>;
	/** Fetches, then points the persistent default-branch worktree at the remote head. */
	defaultBranchWorktree: (target: RepositoryClone) => Promise<Worktree>;
	/** A throwaway worktree checked out at `refs/pull/<number>/head`. */
	pullHeadWorktree: (target: RepositoryClone, number: number) => Promise<LeasedWorktree>;
	/**
	 * Removes pull-head worktrees left behind by a previous run. The default-branch worktree is
	 * kept: it is expensive to check out again and always reset before use anyway.
	 */
	prunePullHeadWorktrees: (target: RepositoryClone) => Promise<string[]>;
}

const DEFAULT_WORKTREE = "proctologist-default";
const PULL_WORKTREE_PREFIX = "proctologist-pr-";

export function createWorktreeManager(options: WorktreeManagerOptions): WorktreeManager {
	const git: GitOptions = { gitPath: options.gitPath, env: options.env };

	/**
	 * Creates the worktree folder and returns its real path. git records worktrees by real path, so
	 * anything we hand it has to be resolved first or later lookups will not match.
	 */
	const worktreesDir = async (repository: string): Promise<string> => {
		const dir = path.join(
			repositoryCacheDir({ cacheDir: options.cacheDir }, repository),
			"worktrees",
		);
		await mkdir(dir, { recursive: true });
		return realpath(dir);
	};

	const remoteFor = (target: RepositoryClone): Promise<Remote> =>
		findRemote(target.clone, target.repository, git);

	const defaultBranch = async (target: RepositoryClone): Promise<string> => {
		const remote = await remoteFor(target);
		const output = await runGit(["ls-remote", "--symref", remote.name, "HEAD"], {
			...git,
			cwd: target.clone,
		});
		const branch = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(output)?.[1];
		if (!branch) {
			throw new GitError(`Could not work out the default branch of ${target.repository}.`, {
				command: `git ls-remote --symref ${remote.name} HEAD`,
			});
		}
		return branch;
	};

	return {
		remoteFor,
		defaultBranch,
		defaultBranchWorktree: async (target) => {
			const remote = await remoteFor(target);
			const branch = await defaultBranch(target);
			const trackingRef = `refs/remotes/${remote.name}/${branch}`;

			await runGit(["fetch", "--quiet", remote.name, `+refs/heads/${branch}:${trackingRef}`], {
				...git,
				cwd: target.clone,
			});
			const commit = await revParse(target.clone, trackingRef, git);
			const worktreePath = path.join(await worktreesDir(target.repository), DEFAULT_WORKTREE);

			await checkout(target.clone, worktreePath, commit, git);
			return { path: worktreePath, commit };
		},
		pullHeadWorktree: async (target, number) => {
			const remote = await remoteFor(target);
			const ref = `refs/proctologist/${remote.name}/pull/${String(number)}`;

			await runGit(["fetch", "--quiet", remote.name, `+refs/pull/${String(number)}/head:${ref}`], {
				...git,
				cwd: target.clone,
			});
			const commit = await revParse(target.clone, ref, git);

			// A suffix keeps a thorough assessment and a review draft of the same pull request from
			// fighting over one directory.
			const worktreePath = path.join(
				await worktreesDir(target.repository),
				`${PULL_WORKTREE_PREFIX}${String(number)}-${randomBytes(4).toString("hex")}`,
			);
			await checkout(target.clone, worktreePath, commit, git);

			let released = false;
			return {
				path: worktreePath,
				commit,
				release: async () => {
					if (released) {
						return;
					}
					released = true;
					await removeWorktree(target.clone, worktreePath, git);
					await runGit(["update-ref", "-d", ref], { ...git, cwd: target.clone }).catch(
						() => undefined,
					);
				},
			};
		},
		prunePullHeadWorktrees: async (target) => {
			const dir = await worktreesDir(target.repository);
			const registered = await listWorktrees(target.clone, git);
			const removed: string[] = [];

			for (const worktree of registered) {
				if (
					path.dirname(worktree) === dir &&
					path.basename(worktree).startsWith(PULL_WORKTREE_PREFIX)
				) {
					// git serialises on its own lock anyway, so these have to run one at a time.
					// oxlint-disable-next-line no-await-in-loop
					await removeWorktree(target.clone, worktree, git);
					removed.push(worktree);
				}
			}

			await runGit(["worktree", "prune"], { ...git, cwd: target.clone });
			return removed;
		},
	};
}

async function revParse(clone: string, ref: string, git: GitOptions): Promise<string> {
	return (await runGit(["rev-parse", ref], { ...git, cwd: clone })).trim();
}

async function listWorktrees(clone: string, git: GitOptions): Promise<string[]> {
	const output = await runGit(["worktree", "list", "--porcelain"], { ...git, cwd: clone });
	return output
		.split("\n")
		.flatMap((line) => (line.startsWith("worktree ") ? [line.slice("worktree ".length)] : []));
}

/** Creates the worktree if it is missing, otherwise moves the existing one to `commit`. */
async function checkout(
	clone: string,
	worktreePath: string,
	commit: string,
	git: GitOptions,
): Promise<void> {
	const registered = await listWorktrees(clone, git);

	if (registered.includes(worktreePath)) {
		await runGit(["checkout", "--detach", "--force", commit], { ...git, cwd: worktreePath });
		await runGit(["clean", "-fdx"], { ...git, cwd: worktreePath });
		return;
	}

	// A directory left behind by a crash would block `worktree add`.
	await rm(worktreePath, { recursive: true, force: true });
	await runGit(["worktree", "prune"], { ...git, cwd: clone });
	await runGit(["worktree", "add", "--detach", "--force", worktreePath, commit], {
		...git,
		cwd: clone,
	});
}

async function removeWorktree(clone: string, worktreePath: string, git: GitOptions): Promise<void> {
	try {
		await runGit(["worktree", "remove", "--force", worktreePath], { ...git, cwd: clone });
	} catch {
		// The registration may already be gone; the directory is what matters.
		await rm(worktreePath, { recursive: true, force: true });
	}
}
