import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildArgs, createCodexRunner, type CodexRunOptions } from "./runner.js";
import type { CodexProgress } from "./events.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CODEX = path.join(here, "__fixtures__", "fake-codex.mjs");

const PROFILE = { reasoningEffort: "medium" as const, timeoutMinutes: 5 };
const SCHEMA = {
	type: "object",
	properties: { answer: { type: "string" } },
	required: ["answer"],
};

let logDir: string;

beforeEach(async () => {
	logDir = await mkdtemp(path.join(os.tmpdir(), "proctologist-codex-"));
});

afterEach(async () => {
	await rm(logDir, { recursive: true, force: true });
});

function runOptions(overrides: Partial<CodexRunOptions> = {}): CodexRunOptions {
	return {
		prompt: "Assess this pull request.",
		cwd: logDir,
		sandbox: "read-only",
		profile: PROFILE,
		schema: SCHEMA,
		label: "assess-owner-thing-101",
		...overrides,
	};
}

function runner(env: NodeJS.ProcessEnv = {}) {
	return createCodexRunner({
		codexPath: FAKE_CODEX,
		logDir,
		env: { ...process.env, FAKE_CODEX_MESSAGE: '{"answer":"yes"}', ...env },
	});
}

describe("buildArgs", () => {
	const files = { messagePath: "/tmp/message", schemaPath: "/tmp/schema.json" };

	it("asks for JSONL events, a detached prompt on stdin and the sandbox", () => {
		const args = buildArgs(runOptions({ cwd: "/work" }), files);

		expect(args.slice(0, 3)).toEqual(["exec", "-", "--ephemeral"]);
		expect(args).toContain("--json");
		expect(args).toContain("--skip-git-repo-check");
		expect(args.join(" ")).toContain("-s read-only");
		expect(args.join(" ")).toContain("-C /work");
		expect(args.join(" ")).toContain("-o /tmp/message");
		expect(args.join(" ")).toContain("--output-schema /tmp/schema.json");
		expect(args).toContain('model_reasoning_effort="medium"');
	});

	it("keeps the session when the run is not ephemeral", () => {
		expect(buildArgs(runOptions({ ephemeral: false }), files)).not.toContain("--ephemeral");
	});

	it("passes a model only when the profile names one", () => {
		expect(buildArgs(runOptions(), files)).not.toContain("-m");
		expect(buildArgs(runOptions({ profile: { ...PROFILE, model: "a-model" } }), files)).toContain(
			"a-model",
		);
	});

	it("leaves out the schema flag when there is no schema", () => {
		expect(
			buildArgs(runOptions({ schema: undefined }), { messagePath: files.messagePath }),
		).not.toContain("--output-schema");
	});

	it("uses the workspace-write sandbox when asked", () => {
		expect(buildArgs(runOptions({ sandbox: "workspace-write" }), files).join(" ")).toContain(
			"-s workspace-write",
		);
	});
});

describe("run", () => {
	it("returns the parsed final message and what Codex did", async () => {
		const progress: CodexProgress[] = [];
		const result = await runner().run<{ answer: string }>(
			runOptions({ onProgress: (event) => progress.push(event) }),
		);

		expect(result.output).toEqual({ answer: "yes" });
		expect(result.commands).toEqual(["ls"]);
		expect(result.usage).toEqual({
			inputTokens: 10,
			cachedInputTokens: 4,
			outputTokens: 2,
			reasoningOutputTokens: 0,
		});
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(progress.map((event) => event.kind)).toEqual([
			"session",
			"command",
			"command",
			"message",
			"turn_completed",
		]);
	});

	it("hides the session id for an ephemeral run and keeps it otherwise", async () => {
		expect((await runner().run(runOptions())).sessionId).toBeNull();
		expect((await runner().run(runOptions({ ephemeral: false }))).sessionId).toBe("thread-1");
	});

	it("sends the prompt on stdin rather than as an argument", async () => {
		const argsFile = path.join(logDir, "args.json");
		await runner({ FAKE_CODEX_ARGS_OUT: argsFile }).run(runOptions({ prompt: "A long prompt." }));

		const recorded = JSON.parse(await readFile(argsFile, "utf8")) as {
			args: string[];
			prompt: string;
		};

		expect(recorded.prompt).toBe("A long prompt.");
		expect(recorded.args).not.toContain("A long prompt.");
	});

	it("writes the events and stderr to a log file", async () => {
		const result = await runner({ FAKE_CODEX_STDERR: "a warning\n" }).run(runOptions());
		const log = await readFile(result.logPath, "utf8");

		expect(result.logPath.startsWith(logDir)).toBe(true);
		expect(log).toContain("thread.started");
		expect(log).toContain("a warning");
	});

	it("returns the raw text when no schema was given", async () => {
		const result = await runner({ FAKE_CODEX_MESSAGE: "just words" }).run(
			runOptions({ schema: undefined }),
		);

		expect(result.output).toBe("just words");
	});

	it("reports a final message that is not the JSON the schema asked for", async () => {
		await expect(
			runner({ FAKE_CODEX_MESSAGE: "not json" }).run(runOptions()),
		).rejects.toMatchObject({ kind: "invalid_output" });
	});

	it("reports a run that produced no final message", async () => {
		const codex = createCodexRunner({ codexPath: FAKE_CODEX, logDir, env: process.env });

		await expect(codex.run(runOptions())).rejects.toMatchObject({ kind: "no_output" });
	});

	it("reports a non-zero exit code", async () => {
		await expect(runner({ FAKE_CODEX_EXIT: "7" }).run(runOptions())).rejects.toMatchObject({
			kind: "failed",
			exitCode: 7,
		});
	});

	it("reports a missing codex executable", async () => {
		const codex = createCodexRunner({
			codexPath: path.join(os.tmpdir(), "no-such-codex"),
			logDir,
		});

		await expect(codex.run(runOptions())).rejects.toMatchObject({ kind: "not_installed" });
	});

	it("stops a run that overruns its timeout and leaves no output behind", async () => {
		const promise = runner({ FAKE_CODEX_SLEEP_MS: "5000" }).run(
			runOptions({ profile: { ...PROFILE, timeoutMinutes: 0.005 } }),
		);

		await expect(promise).rejects.toMatchObject({ kind: "timeout" });
		expect((await readdir(logDir)).some((file) => file.endsWith(".message"))).toBe(false);
	});

	it("stops a run when the caller aborts", async () => {
		const controller = new AbortController();
		const promise = runner({ FAKE_CODEX_SLEEP_MS: "5000" }).run(
			runOptions({ signal: controller.signal }),
		);
		setTimeout(() => {
			controller.abort();
		}, 50);

		await expect(promise).rejects.toMatchObject({ kind: "aborted" });
	});

	it("stops immediately when the signal is already aborted", async () => {
		await expect(
			runner({ FAKE_CODEX_SLEEP_MS: "5000" }).run(runOptions({ signal: AbortSignal.abort() })),
		).rejects.toMatchObject({ kind: "aborted" });
	});

	it("ignores events it does not understand", async () => {
		const events = ['{"type":"something.new","payload":1}', "not json at all"].join("\n");
		const onProgress = vi.fn();

		await runner({ FAKE_CODEX_EVENTS: events }).run(runOptions({ onProgress }));

		expect(onProgress).not.toHaveBeenCalled();
	});
});
