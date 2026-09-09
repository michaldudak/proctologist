#!/usr/bin/env node
// Stands in for the real `codex` in tests. Environment variables decide what it emits:
//   FAKE_CODEX_EVENTS   JSONL printed to stdout, one event per line (defaults to a short run)
//   FAKE_CODEX_MESSAGE  written to the file given by -o (omit to write nothing)
//   FAKE_CODEX_STDERR   written to stderr
//   FAKE_CODEX_EXIT     exit code (default 0)
//   FAKE_CODEX_SLEEP_MS delay before writing the message and exiting
//   FAKE_CODEX_ARGS_OUT file receiving { args, prompt } as JSON
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const env = process.env;

let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
	prompt += chunk;
}

if (env["FAKE_CODEX_ARGS_OUT"]) {
	await writeFile(env["FAKE_CODEX_ARGS_OUT"], JSON.stringify({ args, prompt }), "utf8");
}

const events =
	env["FAKE_CODEX_EVENTS"] ??
	[
		JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
		JSON.stringify({ type: "turn.started" }),
		JSON.stringify({
			type: "item.started",
			item: { id: "item_1", type: "command_execution", command: "ls", status: "in_progress" },
		}),
		JSON.stringify({
			type: "item.completed",
			item: { id: "item_1", type: "command_execution", command: "ls", exit_code: 0 },
		}),
		JSON.stringify({
			type: "item.completed",
			item: { id: "item_2", type: "agent_message", text: "Done." },
		}),
		JSON.stringify({
			type: "turn.completed",
			usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 2 },
		}),
	].join("\n");

process.stdout.write(`${events}\n`);
if (env["FAKE_CODEX_STDERR"]) {
	process.stderr.write(env["FAKE_CODEX_STDERR"]);
}

const sleep = Number(env["FAKE_CODEX_SLEEP_MS"] ?? "0");
if (sleep > 0) {
	await new Promise((resolve) => setTimeout(resolve, sleep));
}

const messagePath = args[args.indexOf("-o") + 1];
if (env["FAKE_CODEX_MESSAGE"] !== undefined && messagePath) {
	await writeFile(messagePath, env["FAKE_CODEX_MESSAGE"], "utf8");
}

process.exit(Number(env["FAKE_CODEX_EXIT"] ?? "0"));
