import { GitError, runGit, type GitOptions } from "./git.js";

export interface Remote {
	name: string;
	url: string;
}

/**
 * The `owner/name` a remote URL points at, for every form git accepts:
 * `git@host:owner/name.git`, `ssh://git@host/owner/name`, `https://host/owner/name.git`.
 * Returns undefined for anything that is not two path segments.
 */
export function repositoryFromRemoteUrl(url: string): string | undefined {
	const withoutScheme = url
		.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
		.replace(/^[^/]*@/, "")
		.replace(/^[^/:]+:/, "/");

	const segments = withoutScheme
		.replace(/\.git$/i, "")
		.split("/")
		.filter((segment) => segment !== "");

	if (segments.length < 2) {
		return undefined;
	}

	return segments.slice(-2).join("/");
}

/** Reads remotes from config rather than `git remote -v`, so URL rewriting cannot confuse us. */
export async function listRemotes(clone: string, options: GitOptions = {}): Promise<Remote[]> {
	const output = await runGit(["config", "--get-regexp", String.raw`^remote\..*\.url$`], {
		...options,
		cwd: clone,
	});

	return output.split("\n").flatMap((line) => {
		const match = /^remote\.(.+)\.url (.+)$/.exec(line.trim());
		return match?.[1] && match[2] ? [{ name: match[1], url: match[2] }] : [];
	});
}

/**
 * Finds the remote pointing at the tracked repository. A maintainer's clone usually has both a
 * fork and the upstream, so the URL decides which one to fetch from, not the remote's name.
 */
export async function findRemote(
	clone: string,
	repository: string,
	options: GitOptions = {},
): Promise<Remote> {
	const wanted = repository.toLowerCase();
	const remotes = await listRemotes(clone, options);
	const match = remotes.find(
		(remote) => repositoryFromRemoteUrl(remote.url)?.toLowerCase() === wanted,
	);

	if (!match) {
		const seen = remotes.map((remote) => `${remote.name} (${remote.url})`).join(", ") || "none";
		throw new GitError(`No remote in ${clone} points at ${repository}. Remotes found: ${seen}.`, {
			command: `git -C ${clone} config --get-regexp remote.*.url`,
		});
	}

	return match;
}
