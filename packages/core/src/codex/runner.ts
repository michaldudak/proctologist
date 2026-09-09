import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseEvent, toProgress, type CodexProgress, type CodexUsage } from "./events.js";
import type { CodexProfile } from "../config/schema.js";

export type CodexSandbox = "read-only" | "workspace-write";

export type CodexErrorKind =
	"not_installed" | "timeout" | "aborted" | "invalid_output" | "no_output" | "failed";

export class CodexError extends Error {
	readonly kind: CodexErrorKind;
	/** Where the full stdout and stderr of the run were written. */
	readonly logPath: string;
	readonly exitCode: number | null;

	constructor(
		kind: CodexErrorKind,
		message: string,
		details: { logPath: string; exitCode?: number | null; cause?: unknown },
	) {
		super(message, { cause: details.cause });
		this.name = "CodexError";
		this.kind = kind;
		this.logPath = details.logPath;
		this.exitCode = details.exitCode ?? null;
	}
}

export interface CodexRunOptions {
	/** Sent on stdin, so a large bundle cannot run into the argument length limit. */
	prompt: string;
	/** Working root for the agent; a worktree, never the user's own clone. */
	cwd: string;
	sandbox: CodexSandbox;
	profile: CodexProfile;
	/** JSON Schema the final message must conform to. Without it the raw text is returned. */
	schema?: unknown;
	/**
	 * Ephemeral runs leave no session behind. Assessments are ephemeral; review drafts are not,
	 * because their session id is kept for follow-ups.
	 */
	ephemeral?: boolean;
	/** A label used in the log file name, for example `assess-owner-thing-101`. */
	label: string;
	signal?: AbortSignal;
	onProgress?: (progress: CodexProgress) => void;
}

export interface CodexResult<T> {
	output: T;
	/** Null for an ephemeral run, which persists nothing. */
	sessionId: string | null;
	logPath: string;
	durationMs: number;
	model: string | null;
	/** Every shell command Codex ran, in order. */
	commands: string[];
	usage: CodexUsage | null;
}

export interface CodexRunnerOptions {
	/** Path to the `codex` executable, so tests can point at a fake one. */
	codexPath?: string;
	env?: NodeJS.ProcessEnv;
	/** Where run logs, schema files and last-message files are written. */
	logDir: string;
}

export interface CodexRunner {
	run: <T = unknown>(options: CodexRunOptions) => Promise<CodexResult<T>>;
}

export function createCodexRunner(options: CodexRunnerOptions): CodexRunner {
	const codexPath = options.codexPath ?? "codex";

	return {
		run: async <T>(run: CodexRunOptions): Promise<CodexResult<T>> => {
			await mkdir(options.logDir, { recursive: true });

			const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
			const base = path.join(options.logDir, `${sanitise(run.label)}-${stamp}`);
			const logPath = `${base}.log`;
			const messagePath = `${base}.message`;
			const schemaPath = run.schema === undefined ? undefined : `${base}.schema.json`;

			if (schemaPath) {
				await writeFile(schemaPath, JSON.stringify(run.schema, null, "\t"), "utf8");
			}

			const args = buildArgs(run, { messagePath, schemaPath });
			const started = Date.now();
			const outcome = await spawnCodex(codexPath, args, run, options.env, logPath);
			const durationMs = Date.now() - started;

			if (outcome.kind !== "exited") {
				await rm(messagePath, { force: true });
				throw new CodexError(
					outcome.kind,
					outcome.kind === "timeout"
						? `Codex did not finish within ${String(run.profile.timeoutMinutes)} minutes.`
						: "Codex was stopped.",
					{ logPath },
				);
			}

			if (outcome.code !== 0) {
				throw new CodexError("failed", `Codex exited with code ${String(outcome.code)}.`, {
					logPath,
					exitCode: outcome.code,
				});
			}

			let message: string;
			try {
				message = await readFile(messagePath, "utf8");
			} catch (cause) {
				throw new CodexError("no_output", "Codex produced no final message.", {
					logPath,
					cause,
				});
			}

			let output: T;
			if (run.schema === undefined) {
				output = message as T;
			} else {
				try {
					output = JSON.parse(message) as T;
				} catch (cause) {
					throw new CodexError(
						"invalid_output",
						"Codex's final message was not the JSON the schema asked for.",
						{ logPath, cause },
					);
				}
			}

			return {
				output,
				sessionId: run.ephemeral === false ? outcome.sessionId : null,
				logPath,
				durationMs,
				model: run.profile.model ?? null,
				commands: outcome.commands,
				usage: outcome.usage,
			};
		},
	};
}

export function buildArgs(
	run: CodexRunOptions,
	files: { messagePath: string; schemaPath?: string | undefined },
): string[] {
	const args = [
		"exec",
		"-",
		"--json",
		"--skip-git-repo-check",
		"-s",
		run.sandbox,
		"-C",
		run.cwd,
		"-o",
		files.messagePath,
		"-c",
		`model_reasoning_effort="${run.profile.reasoningEffort}"`,
	];

	if (run.ephemeral !== false) {
		args.splice(2, 0, "--ephemeral");
	}
	if (run.profile.model) {
		args.push("-m", run.profile.model);
	}
	if (files.schemaPath) {
		args.push("--output-schema", files.schemaPath);
	}

	return args;
}

type SpawnOutcome =
	| {
			kind: "exited";
			code: number | null;
			sessionId: string | null;
			commands: string[];
			usage: CodexUsage | null;
	  }
	| { kind: "timeout" | "aborted" };

function spawnCodex(
	codexPath: string,
	args: string[],
	run: CodexRunOptions,
	env: NodeJS.ProcessEnv | undefined,
	logPath: string,
): Promise<SpawnOutcome> {
	return new Promise<SpawnOutcome>((resolve, reject) => {
		// A process group lets one signal reach the shells Codex spawned as well.
		const child = spawn(codexPath, args, {
			env: env ?? process.env,
			cwd: run.cwd,
			detached: true,
			stdio: ["pipe", "pipe", "pipe"],
		});

		const log = createWriteStream(logPath);
		let sessionId: string | null = null;
		let usage: CodexUsage | null = null;
		const commands: string[] = [];
		let pending = "";
		let stopped: "timeout" | "aborted" | undefined;

		const stop = (reason: "timeout" | "aborted"): void => {
			stopped ??= reason;
			killGroup(child.pid);
		};

		const timer = setTimeout(() => {
			stop("timeout");
		}, run.profile.timeoutMinutes * 60_000);
		const onAbort = (): void => {
			stop("aborted");
		};
		run.signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");

		child.stdout.on("data", (chunk: string) => {
			log.write(chunk);
			pending += chunk;
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			for (const line of lines) {
				const event = parseEvent(line);
				if (!event) {
					continue;
				}
				const progress = toProgress(event);
				if (!progress) {
					continue;
				}
				if (progress.kind === "session") {
					sessionId = progress.sessionId;
				}
				if (progress.kind === "command" && progress.status === "started") {
					commands.push(progress.command);
				}
				if (progress.kind === "turn_completed") {
					usage = progress.usage;
				}
				run.onProgress?.(progress);
			}
		});

		child.stderr.on("data", (chunk: string) => {
			log.write(chunk);
		});

		child.on("error", (cause: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			run.signal?.removeEventListener("abort", onAbort);
			log.end();
			reject(
				cause.code === "ENOENT"
					? new CodexError(
							"not_installed",
							`Could not run "${codexPath}". Install the Codex CLI and make sure it is on PATH.`,
							{ logPath, cause },
						)
					: new CodexError("failed", `Could not run "${codexPath}": ${cause.message}`, {
							logPath,
							cause,
						}),
			);
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			run.signal?.removeEventListener("abort", onAbort);
			log.end();
			resolve(stopped ? { kind: stopped } : { kind: "exited", code, sessionId, commands, usage });
		});

		child.stdin.on("error", () => {
			// Codex can exit before the prompt is fully written; the exit is the real error.
		});
		child.stdin.end(run.prompt);

		if (run.signal?.aborted) {
			stop("aborted");
		}
	});
}

function killGroup(pid: number | undefined): void {
	if (pid === undefined) {
		return;
	}
	try {
		process.kill(-pid, "SIGTERM");
	} catch {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// Already gone.
		}
	}
}

function sanitise(label: string): string {
	return label.replaceAll(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80);
}
