import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claudeDialect } from "./claude.js";
import { codexDialect } from "./codex.js";
import { createAgentRunner } from "./runner.js";
import type { AgentKind, AgentProfile, AgentProgress, AgentRunOptions } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = {
	codex: path.join(here, "__fixtures__", "fake-codex.mjs"),
	claude: path.join(here, "__fixtures__", "fake-claude.mjs"),
};

const SCHEMA = {
	type: "object",
	properties: { answer: { type: "string" } },
	required: ["answer"],
};

/** The environment each fake needs to answer a run the way its real CLI would. */
const ANSWERS: Record<AgentKind, NodeJS.ProcessEnv> = {
	codex: { FAKE_CODEX_MESSAGE: '{"answer":"yes"}' },
	claude: { FAKE_CLAUDE_RESULT: '{"answer":"yes"}' },
};

let logDir: string;

beforeEach(async () => {
	logDir = await mkdtemp(path.join(os.tmpdir(), "proctologist-agent-"));
});

afterEach(async () => {
	await rm(logDir, { recursive: true, force: true });
});

function profile(agent: AgentKind, overrides: Partial<AgentProfile> = {}): AgentProfile {
	return { agent, effort: "medium", timeoutMinutes: 5, ...overrides };
}

function runOptions(agent: AgentKind, overrides: Partial<AgentRunOptions> = {}): AgentRunOptions {
	return {
		prompt: "Assess this pull request.",
		cwd: logDir,
		sandbox: "read-only",
		profile: profile(agent),
		schema: SCHEMA,
		label: "assess-owner-thing-101",
		...overrides,
	};
}

function runner(agent: AgentKind, env: NodeJS.ProcessEnv = {}) {
	return createAgentRunner({
		agentPaths: { [agent]: FAKE[agent] },
		logDir,
		env: { ...process.env, ...ANSWERS[agent], ...env },
	});
}

describe("the Codex dialect's arguments", () => {
	const files = { messagePath: "/tmp/message", schemaPath: "/tmp/schema.json" };
	const args = (overrides: Partial<AgentRunOptions> = {}): string[] =>
		codexDialect.args(runOptions("codex", { cwd: "/work", ...overrides }), files);

	it("asks for JSONL events, a detached prompt on stdin and the sandbox", () => {
		expect(args().slice(0, 3)).toEqual(["exec", "-", "--ephemeral"]);
		expect(args()).toContain("--json");
		expect(args()).toContain("--skip-git-repo-check");
		expect(args().join(" ")).toContain("-s read-only");
		expect(args().join(" ")).toContain("-C /work");
		expect(args().join(" ")).toContain("-o /tmp/message");
		expect(args().join(" ")).toContain("--output-schema /tmp/schema.json");
		expect(args()).toContain('model_reasoning_effort="medium"');
	});

	it("keeps the session when the run is not ephemeral", () => {
		expect(args({ ephemeral: false })).not.toContain("--ephemeral");
	});

	it("passes a model only when the profile names one", () => {
		expect(args()).not.toContain("-m");
		expect(args({ profile: profile("codex", { model: "a-model" }) })).toContain("a-model");
	});

	it("leaves out the schema flag when there is no schema", () => {
		expect(
			codexDialect.args(runOptions("codex", { schema: undefined }), {
				messagePath: "/tmp/message",
				schemaPath: undefined,
			}),
		).not.toContain("--output-schema");
	});

	it("uses the workspace-write sandbox when asked", () => {
		expect(args({ sandbox: "workspace-write" }).join(" ")).toContain("-s workspace-write");
	});
});

describe("the Claude dialect's arguments", () => {
	const files = { messagePath: "/tmp/message", schemaPath: "/tmp/schema.json" };
	const args = (overrides: Partial<AgentRunOptions> = {}): string[] =>
		claudeDialect.args(runOptions("claude", { cwd: "/work", ...overrides }), files);

	it("asks for the streamed message log and the effort the profile names", () => {
		expect(args().join(" ")).toContain("--print");
		expect(args().join(" ")).toContain("--output-format stream-json");
		expect(args()).toContain("--verbose");
		expect(args().join(" ")).toContain("--effort medium");
	});

	it("takes the schema itself rather than a path to it", () => {
		expect(args()[args().indexOf("--json-schema") + 1]).toBe(JSON.stringify(SCHEMA));
		expect(args({ schema: undefined })).not.toContain("--json-schema");
	});

	it("drops the meta-schema declaration its validator refuses to resolve", () => {
		const stamped = { $schema: "https://json-schema.org/draft/2020-12/schema", ...SCHEMA };
		const passed = args({ schema: stamped });

		expect(passed[passed.indexOf("--json-schema") + 1]).toBe(JSON.stringify(SCHEMA));
	});

	it("takes the editing tools away for a read-only run and leaves them for a writing one", () => {
		expect(args()).toContain("Edit");
		expect(args({ sandbox: "workspace-write" })).not.toContain("--disallowed-tools");
	});

	it("keeps the session on disk only when the run is not ephemeral", () => {
		expect(args()).toContain("--no-session-persistence");
		expect(args({ ephemeral: false })).not.toContain("--no-session-persistence");
	});

	it("passes a model only when the profile names one", () => {
		expect(args()).not.toContain("--model");
		expect(args({ profile: profile("claude", { model: "opus" }) })).toContain("opus");
	});
});

describe.each(["codex", "claude"] as const)("running %s", (agent) => {
	it("returns the parsed final message and what the agent did", async () => {
		const progress: AgentProgress[] = [];
		const result = await runner(agent).run<{ answer: string }>(
			runOptions(agent, { onProgress: (event) => progress.push(event) }),
		);

		expect(result.output).toEqual({ answer: "yes" });
		expect(result.agent).toBe(agent);
		expect(result.commands).toEqual(["ls"]);
		expect(result.usage).toEqual({
			inputTokens: 10,
			cachedInputTokens: 4,
			outputTokens: 2,
			reasoningOutputTokens: 0,
		});
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(progress.map((event) => event.kind)).toContain("command");
	});

	it("hides the session id for an ephemeral run and keeps it otherwise", async () => {
		expect((await runner(agent).run(runOptions(agent))).sessionId).toBeNull();
		expect((await runner(agent).run(runOptions(agent, { ephemeral: false }))).sessionId).toBe(
			agent === "codex" ? "thread-1" : "session-1",
		);
	});

	it("sends the prompt on stdin rather than as an argument", async () => {
		const argsFile = path.join(logDir, "args.json");
		await runner(agent, {
			[`FAKE_${agent.toUpperCase()}_ARGS_OUT`]: argsFile,
		}).run(runOptions(agent, { prompt: "A long prompt." }));

		const recorded = JSON.parse(await readFile(argsFile, "utf8")) as {
			args: string[];
			prompt: string;
		};

		expect(recorded.prompt).toBe("A long prompt.");
		expect(recorded.args).not.toContain("A long prompt.");
	});

	it("writes the events and stderr to a log file", async () => {
		const result = await runner(agent, {
			[`FAKE_${agent.toUpperCase()}_STDERR`]: "a warning\n",
		}).run(runOptions(agent));
		const log = await readFile(result.logPath, "utf8");

		expect(result.logPath.startsWith(logDir)).toBe(true);
		expect(log).toContain("a warning");
	});

	it("returns the raw text when no schema was given", async () => {
		const result = await runner(agent, {
			FAKE_CODEX_MESSAGE: "just words",
			FAKE_CLAUDE_RESULT: "just words",
		}).run(runOptions(agent, { schema: undefined }));

		expect(result.output).toBe("just words");
	});

	it("reports a final message that is not the JSON the schema asked for", async () => {
		await expect(
			runner(agent, { FAKE_CODEX_MESSAGE: "not json", FAKE_CLAUDE_RESULT: "not json" }).run(
				runOptions(agent),
			),
		).rejects.toMatchObject({ kind: "invalid_output", agent });
	});

	it("reports a run that produced no final message", async () => {
		const bare = createAgentRunner({ agentPaths: { [agent]: FAKE[agent] }, logDir });

		await expect(bare.run(runOptions(agent))).rejects.toMatchObject({ kind: "no_output" });
	});

	it("reports a non-zero exit code", async () => {
		await expect(
			runner(agent, { [`FAKE_${agent.toUpperCase()}_EXIT`]: "7" }).run(runOptions(agent)),
		).rejects.toMatchObject({ kind: "failed", exitCode: 7 });
	});

	it("reports a missing executable", async () => {
		const missing = createAgentRunner({
			agentPaths: { [agent]: path.join(os.tmpdir(), "no-such-agent") },
			logDir,
		});

		await expect(missing.run(runOptions(agent))).rejects.toMatchObject({ kind: "not_installed" });
	});

	it("stops a run that overruns its timeout and leaves no output behind", async () => {
		const promise = runner(agent, { [`FAKE_${agent.toUpperCase()}_SLEEP_MS`]: "5000" }).run(
			runOptions(agent, { profile: profile(agent, { timeoutMinutes: 0.005 }) }),
		);

		await expect(promise).rejects.toMatchObject({ kind: "timeout" });
		expect((await readdir(logDir)).some((file) => file.endsWith(".message"))).toBe(false);
	});

	it("stops a run when the caller aborts", async () => {
		const controller = new AbortController();
		const promise = runner(agent, { [`FAKE_${agent.toUpperCase()}_SLEEP_MS`]: "5000" }).run(
			runOptions(agent, { signal: controller.signal }),
		);
		setTimeout(() => {
			controller.abort();
		}, 50);

		await expect(promise).rejects.toMatchObject({ kind: "aborted" });
	});

	it("stops immediately when the signal is already aborted", async () => {
		await expect(
			runner(agent, { [`FAKE_${agent.toUpperCase()}_SLEEP_MS`]: "5000" }).run(
				runOptions(agent, { signal: AbortSignal.abort() }),
			),
		).rejects.toMatchObject({ kind: "aborted" });
	});

	it("ignores events it does not understand", async () => {
		const events = ['{"type":"something.new","payload":1}', "not json at all"].join("\n");
		const onProgress = vi.fn();

		await runner(agent, {
			FAKE_CODEX_EVENTS: events,
			FAKE_CLAUDE_MESSAGES: events,
		}).run(runOptions(agent, { onProgress }));

		expect(onProgress.mock.calls.every(([event]) => event.kind === "result")).toBe(true);
	});
});

describe("running claude", () => {
	it("treats a failure it reports in-band as a failure, not as an answer", async () => {
		await expect(
			runner("claude", { FAKE_CLAUDE_IS_ERROR: "1", FAKE_CLAUDE_RESULT: "Not logged in" }).run(
				runOptions("claude"),
			),
		).rejects.toMatchObject({ kind: "failed", agent: "claude" });
	});

	it("reports the model the run actually used, not only the one asked for", async () => {
		const result = await runner("claude").run(runOptions("claude"));

		expect(result.model).toBe("a-model");
	});
});
