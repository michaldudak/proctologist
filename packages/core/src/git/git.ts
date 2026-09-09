import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expandHome } from "../config/paths.js";

const run = promisify(execFile);

/** Anything that goes wrong running `git`, with the command kept for the log. */
export class GitError extends Error {
	readonly command: string;
	readonly stderr: string;

	constructor(message: string, details: { command: string; stderr?: string; cause?: unknown }) {
		super(message, { cause: details.cause });
		this.name = "GitError";
		this.command = details.command;
		this.stderr = details.stderr ?? "";
	}
}

export interface GitOptions {
	/** Path to the `git` executable, so tests can point elsewhere. */
	gitPath?: string;
	env?: NodeJS.ProcessEnv;
}

export interface RunGitOptions extends GitOptions {
	/** Repository the command runs in, passed as `-C`. */
	cwd: string;
	signal?: AbortSignal;
}

export async function runGit(args: string[], options: RunGitOptions): Promise<string> {
	const gitPath = options.gitPath ?? "git";
	// Clone paths come from a config file or a text field, where `~/code/thing` is what a person
	// writes. The shell would expand it; `git -C` will not, so it is expanded here, once, for every
	// git command the app runs.
	const cwd = expandHome(options.cwd);
	const command = `git -C ${cwd} ${args.join(" ")}`;

	try {
		const { stdout } = await run(gitPath, ["-C", cwd, ...args], {
			env: options.env ?? process.env,
			signal: options.signal,
			maxBuffer: 64 * 1024 * 1024,
		});
		return stdout;
	} catch (cause) {
		const stderr =
			typeof cause === "object" && cause !== null && "stderr" in cause
				? String((cause as { stderr: unknown }).stderr)
				: "";
		const code = (cause as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			throw new GitError(`Could not run "${gitPath}". Install git and make sure it is on PATH.`, {
				command,
				cause,
			});
		}
		throw new GitError(`${command} failed: ${firstLine(stderr) || String(cause)}`, {
			command,
			stderr,
			cause,
		});
	}
}

function firstLine(text: string): string {
	return text.trim().split("\n")[0]?.trim() ?? "";
}
