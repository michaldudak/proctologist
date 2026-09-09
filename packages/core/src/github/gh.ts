import { spawn } from "node:child_process";

export type GitHubErrorKind =
	| "not_installed"
	| "not_authenticated"
	| "rate_limited"
	| "not_found"
	| "invalid_output"
	| "failed";

/** Everything that can go wrong talking to `gh`, classified so callers can react per kind. */
export class GitHubError extends Error {
	readonly kind: GitHubErrorKind;
	readonly stderr: string;
	readonly exitCode: number | null;

	constructor(
		kind: GitHubErrorKind,
		message: string,
		details: { stderr?: string; exitCode?: number | null; cause?: unknown } = {},
	) {
		super(message, { cause: details.cause });
		this.name = "GitHubError";
		this.kind = kind;
		this.stderr = details.stderr ?? "";
		this.exitCode = details.exitCode ?? null;
	}
}

export interface GhOptions {
	/** Path to the `gh` executable, so tests can point at a fake one. */
	ghPath?: string;
	env?: NodeJS.ProcessEnv;
	cwd?: string;
}

export interface GhRunOptions {
	/** Written to the process's stdin, for `gh api --input -`. */
	input?: string;
	signal?: AbortSignal;
}

export interface GhResult {
	stdout: string;
	stderr: string;
}

/**
 * Runs `gh` and returns its output. Every call the app makes is a read; nothing here ever mutates
 * anything on GitHub.
 */
export async function runGh(
	args: string[],
	options: GhOptions & GhRunOptions = {},
): Promise<GhResult> {
	const ghPath = options.ghPath ?? "gh";

	return new Promise<GhResult>((resolve, reject) => {
		const child = spawn(ghPath, args, {
			env: options.env ?? process.env,
			cwd: options.cwd,
			stdio: ["pipe", "pipe", "pipe"],
			signal: options.signal,
		});

		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});

		child.on("error", (cause: NodeJS.ErrnoException) => {
			if (cause.code === "ENOENT") {
				reject(
					new GitHubError(
						"not_installed",
						`Could not run "${ghPath}". Install the GitHub CLI and make sure it is on PATH.`,
						{ cause },
					),
				);
				return;
			}
			reject(new GitHubError("failed", `Could not run "${ghPath}": ${cause.message}`, { cause }));
		});

		child.on("close", (code) => {
			if (code === 0) {
				resolve({ stdout, stderr });
				return;
			}
			reject(classify(args, stdout, stderr, code));
		});

		if (options.input !== undefined) {
			child.stdin.end(options.input);
		} else {
			child.stdin.end();
		}
	});
}

/** Runs `gh` and parses its stdout as JSON. */
export async function runGhJson<T>(
	args: string[],
	options: GhOptions & GhRunOptions = {},
): Promise<T> {
	const { stdout } = await runGh(args, options);
	try {
		return JSON.parse(stdout) as T;
	} catch (cause) {
		throw new GitHubError("invalid_output", `gh ${args[0] ?? ""} did not return JSON`, {
			cause,
			stderr: stdout.slice(0, 400),
		});
	}
}

function classify(
	args: string[],
	stdout: string,
	stderr: string,
	exitCode: number | null,
): GitHubError {
	const text = `${stderr}\n${stdout}`;
	const details = { stderr, exitCode };

	if (/gh auth login|not logged into|authentication token|requires authentication/i.test(text)) {
		return new GitHubError(
			"not_authenticated",
			"The GitHub CLI is not authenticated. Run `gh auth login` and try again.",
			details,
		);
	}
	if (/rate limit/i.test(text)) {
		return new GitHubError(
			"rate_limited",
			"GitHub rate limit reached. Wait for it to reset and try again.",
			details,
		);
	}
	if (/Could not resolve to a|HTTP 404|Not Found/i.test(text)) {
		return new GitHubError(
			"not_found",
			"GitHub returned Not Found. Check the repository name and your access to it.",
			details,
		);
	}

	const summary = firstLine(stderr) || firstLine(stdout) || `exit code ${String(exitCode)}`;
	return new GitHubError("failed", `gh ${args.join(" ")} failed: ${summary}`, details);
}

function firstLine(text: string): string {
	return text.trim().split("\n")[0]?.trim() ?? "";
}
