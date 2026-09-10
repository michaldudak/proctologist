import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { claudeDialect } from "./claude.js";
import { codexDialect } from "./codex.js";
import {
	AgentError,
	AGENT_EXECUTABLES,
	AGENT_LABELS,
	type AgentDialect,
	type AgentKind,
	type AgentProgress,
	type AgentRunOptions,
	type AgentResult,
	type AgentRunner,
	type AgentUsage,
} from "./types.js";

const DIALECTS: Record<AgentKind, AgentDialect> = {
	codex: codexDialect,
	claude: claudeDialect,
};

export interface AgentRunnerOptions {
	/** Where run logs, schema files and last-message files are written. */
	logDir: string;
	/** Paths to each agent's executable, so tests and packaged builds can point elsewhere. */
	agentPaths?: Partial<Record<AgentKind, string>>;
	env?: NodeJS.ProcessEnv;
}

/**
 * One runner for every agent. Which CLI a run reaches for is decided by its profile, so a
 * repository can be assessed by one agent and reviewed by another without anything upstream
 * knowing there is more than one.
 *
 * Everything that is the same whichever agent runs — the log file, the timeout, the abort, reading
 * the final message — lives here; everything that differs lives in that agent's dialect.
 */
export function createAgentRunner(options: AgentRunnerOptions): AgentRunner {
	return {
		run: async <T>(run: AgentRunOptions): Promise<AgentResult<T>> => {
			const dialect = DIALECTS[run.profile.agent];
			const executable = options.agentPaths?.[dialect.kind] ?? AGENT_EXECUTABLES[dialect.kind];

			await mkdir(options.logDir, { recursive: true });

			const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
			const base = path.join(options.logDir, `${sanitise(run.label)}-${stamp}`);
			const logPath = `${base}.log`;
			const messagePath = `${base}.message`;
			const schemaPath = run.schema === undefined ? undefined : `${base}.schema.json`;

			if (schemaPath) {
				await writeFile(schemaPath, JSON.stringify(run.schema, null, "\t"), "utf8");
			}

			const args = dialect.args(run, { messagePath, schemaPath });
			const started = Date.now();
			const outcome = await spawnAgent(dialect, executable, args, run, options.env, logPath);
			const durationMs = Date.now() - started;

			if (outcome.kind !== "exited") {
				await rm(messagePath, { force: true });
				throw new AgentError(
					outcome.kind,
					outcome.kind === "timeout"
						? `${AGENT_LABELS[dialect.kind]} did not finish within ${String(run.profile.timeoutMinutes)} minutes.`
						: `${AGENT_LABELS[dialect.kind]} was stopped.`,
					{ agent: dialect.kind, logPath },
				);
			}

			if (outcome.code !== 0) {
				throw new AgentError(
					"failed",
					`${AGENT_LABELS[dialect.kind]} exited with code ${String(outcome.code)}.`,
					{ agent: dialect.kind, logPath, exitCode: outcome.code },
				);
			}

			// An agent can report a failure in-band and still exit zero, which is a failure all the same.
			if (outcome.failure !== null) {
				throw new AgentError("failed", `${AGENT_LABELS[dialect.kind]} failed: ${outcome.failure}`, {
					agent: dialect.kind,
					logPath,
				});
			}

			const message = await finalMessage(dialect, outcome.message, messagePath);
			if (message === undefined) {
				throw new AgentError(
					"no_output",
					`${AGENT_LABELS[dialect.kind]} produced no final message.`,
					{
						agent: dialect.kind,
						logPath,
					},
				);
			}

			let output: T;
			if (run.schema === undefined) {
				output = message as T;
			} else {
				try {
					output = JSON.parse(message) as T;
				} catch (cause) {
					throw new AgentError(
						"invalid_output",
						`${AGENT_LABELS[dialect.kind]}'s final message was not the JSON the schema asked for.`,
						{ agent: dialect.kind, logPath, cause },
					);
				}
			}

			return {
				output,
				agent: dialect.kind,
				sessionId: run.ephemeral === false ? outcome.sessionId : null,
				logPath,
				durationMs,
				model: outcome.model ?? run.profile.model ?? null,
				commands: outcome.commands,
				usage: outcome.usage,
			};
		},
	};
}

async function finalMessage(
	dialect: AgentDialect,
	streamed: string | null,
	messagePath: string,
): Promise<string | undefined> {
	if (!dialect.writesMessageFile) {
		return streamed ?? undefined;
	}
	try {
		return await readFile(messagePath, "utf8");
	} catch {
		return undefined;
	}
}

type SpawnOutcome =
	| {
			kind: "exited";
			code: number | null;
			sessionId: string | null;
			commands: string[];
			usage: AgentUsage | null;
			model: string | null;
			/** The last message, for agents that stream it rather than writing it to a file. */
			message: string | null;
			/** What the agent said went wrong, when it said so rather than exiting non-zero. */
			failure: string | null;
	  }
	| { kind: "timeout" | "aborted" };

function spawnAgent(
	dialect: AgentDialect,
	executable: string,
	args: string[],
	run: AgentRunOptions,
	env: NodeJS.ProcessEnv | undefined,
	logPath: string,
): Promise<SpawnOutcome> {
	return new Promise<SpawnOutcome>((resolve, reject) => {
		// A process group lets one signal reach the shells the agent spawned as well.
		const child = spawn(executable, args, {
			env: env ?? process.env,
			cwd: run.cwd,
			detached: true,
			stdio: ["pipe", "pipe", "pipe"],
		});

		const log = createWriteStream(logPath);
		const read = dialect.reader();
		const commands: string[] = [];
		let sessionId: string | null = null;
		let usage: AgentUsage | null = null;
		let model: string | null = null;
		let message: string | null = null;
		let failure: string | null = null;
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

		const absorb = (progress: AgentProgress): void => {
			switch (progress.kind) {
				case "session": {
					sessionId = progress.sessionId;
					model = progress.model ?? model;
					break;
				}
				case "command": {
					if (progress.status === "started") {
						commands.push(progress.command);
					}
					break;
				}
				case "turn_completed": {
					usage = progress.usage;
					break;
				}
				case "result": {
					message = progress.text;
					failure = progress.error;
					usage = progress.usage ?? usage;
					model = progress.model ?? model;
					break;
				}
				default: {
					break;
				}
			}
		};

		child.stdout.on("data", (chunk: string) => {
			log.write(chunk);
			pending += chunk;
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			for (const line of lines) {
				const progress = read(line);
				if (!progress) {
					continue;
				}
				absorb(progress);
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
					? new AgentError(
							"not_installed",
							`Could not run "${executable}". Install the ${AGENT_LABELS[dialect.kind]} CLI and make sure it is on PATH.`,
							{ agent: dialect.kind, logPath, cause },
						)
					: new AgentError("failed", `Could not run "${executable}": ${cause.message}`, {
							agent: dialect.kind,
							logPath,
							cause,
						}),
			);
		});

		child.on("close", (code) => {
			clearTimeout(timer);
			run.signal?.removeEventListener("abort", onAbort);
			log.end();
			resolve(
				stopped
					? { kind: stopped }
					: { kind: "exited", code, sessionId, commands, usage, model, message, failure },
			);
		});

		child.stdin.on("error", () => {
			// An agent can exit before the prompt is fully written; the exit is the real error.
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
