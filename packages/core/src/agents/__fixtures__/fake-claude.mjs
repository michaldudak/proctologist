#!/usr/bin/env node
// Stands in for the real `claude` in tests. Environment variables decide what it emits:
//   FAKE_CLAUDE_MESSAGES  JSONL printed to stdout, one message per line (defaults to a short run)
//   FAKE_CLAUDE_RESULT    the text of the final `result` message (omit to emit no result at all)
//   FAKE_CLAUDE_IS_ERROR  "1" to mark the result as a failure while still exiting zero
//   FAKE_CLAUDE_STDERR    written to stderr
//   FAKE_CLAUDE_EXIT      exit code (default 0)
//   FAKE_CLAUDE_SLEEP_MS  delay before the result message and exiting
//   FAKE_CLAUDE_ARGS_OUT  file receiving { args, prompt } as JSON
import { writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const env = process.env;

let prompt = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
	prompt += chunk;
}

if (env["FAKE_CLAUDE_ARGS_OUT"]) {
	await writeFile(env["FAKE_CLAUDE_ARGS_OUT"], JSON.stringify({ args, prompt }), "utf8");
}

const messages =
	env["FAKE_CLAUDE_MESSAGES"] ??
	[
		JSON.stringify({ type: "system", subtype: "init", session_id: "session-1", model: "a-model" }),
		JSON.stringify({
			type: "assistant",
			message: {
				content: [{ type: "tool_use", id: "call_1", name: "Bash", input: { command: "ls" } }],
			},
		}),
		JSON.stringify({
			type: "user",
			message: { content: [{ type: "tool_result", tool_use_id: "call_1", is_error: false }] },
		}),
		JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Done." }] } }),
	].join("\n");

process.stdout.write(`${messages}\n`);
if (env["FAKE_CLAUDE_STDERR"]) {
	process.stderr.write(env["FAKE_CLAUDE_STDERR"]);
}

const sleep = Number(env["FAKE_CLAUDE_SLEEP_MS"] ?? "0");
if (sleep > 0) {
	await new Promise((resolve) => setTimeout(resolve, sleep));
}

if (env["FAKE_CLAUDE_RESULT"] !== undefined) {
	process.stdout.write(
		`${JSON.stringify({
			type: "result",
			subtype: "success",
			is_error: env["FAKE_CLAUDE_IS_ERROR"] === "1",
			result: env["FAKE_CLAUDE_RESULT"],
			model: "a-model",
			usage: {
				input_tokens: 8,
				cache_creation_input_tokens: 2,
				cache_read_input_tokens: 4,
				output_tokens: 2,
			},
		})}\n`,
	);
}

process.exit(Number(env["FAKE_CLAUDE_EXIT"] ?? "0"));
