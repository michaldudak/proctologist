import { describe, expect, it } from "vitest";
import { claudeDialect } from "./claude.js";
import { claudeCatalog, parseClaudeEfforts } from "./claude.js";
import type { AgentProgress } from "./types.js";

/** As Claude Code's own `--help` renders it, wrapped across lines and all. */
const HELP = `Options:
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --model <model>                       Model for the current session.
`;

function read(lines: string[]): (AgentProgress | undefined)[] {
	const reader = claudeDialect.reader();
	return lines.map((line) => reader(line));
}

describe("parseClaudeEfforts", () => {
	it("reads the levels out of the installed CLI's own help", () => {
		expect(parseClaudeEfforts(HELP).map((level) => level.effort)).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
	});

	it("says nothing rather than guessing when the help has changed shape", () => {
		expect(parseClaudeEfforts("Options:\n  --model <model>  A model.\n")).toEqual([]);
	});
});

describe("claudeCatalog", () => {
	it("leaves the model open, because Claude Code cannot be asked which it has", () => {
		const catalog = claudeCatalog(HELP);

		expect(catalog.agent).toBe("claude");
		expect(catalog.openModels).toBe(true);
		expect(catalog.models).toEqual([]);
		expect(catalog.efforts).toHaveLength(5);
	});
});

describe("the Claude message reader", () => {
	it("takes the session id and the model from the init message", () => {
		expect(
			read([
				JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "opus-5" }),
			])[0],
		).toEqual({ kind: "session", sessionId: "s1", model: "opus-5" });
	});

	it("pairs a tool result back to the command that asked for it", () => {
		const progress = read([
			JSON.stringify({
				type: "assistant",
				message: {
					content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "git log" } }],
				},
			}),
			JSON.stringify({
				type: "user",
				message: { content: [{ type: "tool_result", tool_use_id: "c1", is_error: true }] },
			}),
		]);

		expect(progress[0]).toEqual({ kind: "command", command: "git log", status: "started" });
		expect(progress[1]).toEqual({
			kind: "command",
			command: "git log",
			status: "finished",
			exitCode: 1,
		});
	});

	it("reads the result's own tokens, counting cache writes as input and reads apart", () => {
		expect(
			read([
				JSON.stringify({
					type: "result",
					is_error: false,
					result: "done",
					usage: {
						input_tokens: 8,
						cache_creation_input_tokens: 2,
						cache_read_input_tokens: 4,
						output_tokens: 3,
					},
				}),
			])[0],
		).toMatchObject({
			kind: "result",
			text: "done",
			error: null,
			usage: {
				inputTokens: 10,
				cachedInputTokens: 4,
				outputTokens: 3,
				reasoningOutputTokens: 0,
			},
		});
	});

	it("carries a failure it reports in-band", () => {
		expect(
			read([JSON.stringify({ type: "result", is_error: true, result: "Not logged in" })])[0],
		).toMatchObject({ kind: "result", error: "Not logged in" });
	});

	it("ignores messages it does not understand", () => {
		expect(read(['{"type":"something_new"}', "not json at all", ""])).toEqual([
			undefined,
			undefined,
			undefined,
		]);
	});
});
