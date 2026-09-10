/**
 * Everything specific to the Claude Code CLI: how `claude -p` is spelled, the JSONL messages
 * `--output-format stream-json` prints, and the effort levels the installed CLI accepts. Only the
 * fields the app uses are described; unknown messages are ignored rather than rejected.
 */
import { emptyCatalog, type AgentCatalog, type AgentEffortLevel } from "./catalog.js";
import type { AgentDialect, AgentUsage } from "./types.js";

interface ClaudeMessage {
	type: string;
	subtype?: string;
	session_id?: string;
	model?: string;
	is_error?: boolean;
	result?: string;
	usage?: Record<string, number>;
	message?: {
		model?: string;
		content?: {
			type?: string;
			text?: string;
			name?: string;
			id?: string;
			tool_use_id?: string;
			is_error?: boolean;
			input?: { command?: string };
		}[];
	};
}

/**
 * Claude Code has no sandbox flag. The nearest thing to Codex's two sandboxes is to let it run
 * without stopping to ask — it cannot be asked anything in print mode — and to take the file-editing
 * tools away when the run is meant to read only. Neither agent's sandbox can stop `gh` from
 * writing, which is why the read-only rule is carried by the prompt as well (ADR 0003).
 */
const READ_ONLY_TOOLS_DENIED = ["Edit", "Write", "NotebookEdit"];

export const claudeDialect: AgentDialect = {
	kind: "claude",
	// Claude streams its last word as a `result` message instead of writing it to a file.
	writesMessageFile: false,

	args: (run) => {
		const args = [
			"--print",
			"--output-format",
			"stream-json",
			// stream-json only emits the message stream when it is asked to be verbose.
			"--verbose",
			"--permission-mode",
			"bypassPermissions",
			"--effort",
			run.profile.effort,
		];

		if (run.profile.model) {
			args.push("--model", run.profile.model);
		}
		if (run.sandbox === "read-only") {
			args.push("--disallowed-tools", ...READ_ONLY_TOOLS_DENIED);
		}
		if (run.schema !== undefined) {
			// Claude takes the schema itself rather than a path to one, so the file goes unused.
			args.push("--json-schema", JSON.stringify(run.schema));
		}
		if (run.ephemeral !== false) {
			args.push("--no-session-persistence");
		}

		return args;
	},

	reader: () => {
		// A tool result names the tool call it answers, not the command, so the calls are remembered.
		const commands = new Map<string, string>();

		return (line) => {
			const message = parse(line);
			if (!message) {
				return undefined;
			}

			switch (message.type) {
				case "system": {
					if (message.subtype !== "init") {
						return undefined;
					}
					return message.session_id
						? { kind: "session", sessionId: message.session_id }
						: undefined;
				}
				case "assistant": {
					for (const part of message.message?.content ?? []) {
						if (part.type === "tool_use" && part.name === "Bash" && part.input?.command) {
							if (part.id) {
								commands.set(part.id, part.input.command);
							}
							return { kind: "command", command: part.input.command, status: "started" };
						}
						if (part.type === "text" && part.text) {
							return { kind: "message", text: part.text };
						}
					}
					return undefined;
				}
				case "user": {
					for (const part of message.message?.content ?? []) {
						const command = part.tool_use_id ? commands.get(part.tool_use_id) : undefined;
						if (command !== undefined) {
							return {
								kind: "command",
								command,
								status: "finished",
								exitCode: part.is_error === true ? 1 : 0,
							};
						}
					}
					return undefined;
				}
				case "result": {
					return {
						kind: "result",
						text: message.result ?? null,
						error: message.is_error === true ? (message.result ?? "The run failed.") : null,
						usage: toUsage(message.usage),
						model: message.model ?? null,
					};
				}
				default: {
					return undefined;
				}
			}
		};
	},
};

function parse(line: string): ClaudeMessage | undefined {
	const trimmed = line.trim();
	if (trimmed === "" || !trimmed.startsWith("{")) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed) as ClaudeMessage;
	} catch {
		return undefined;
	}
}

function toUsage(usage: Record<string, number> | undefined): AgentUsage | null {
	if (!usage) {
		return null;
	}
	return {
		inputTokens: (usage["input_tokens"] ?? 0) + (usage["cache_creation_input_tokens"] ?? 0),
		cachedInputTokens: usage["cache_read_input_tokens"] ?? 0,
		outputTokens: usage["output_tokens"] ?? 0,
		// Claude does not report reasoning tokens apart from the rest of its output.
		reasoningOutputTokens: 0,
	};
}

/**
 * The effort levels the installed Claude Code accepts, read out of its own `--help`. There is no
 * machine-readable catalog command, and the levels have changed between releases, so asking the
 * binary that will run the job still beats a list written down here.
 */
export function parseClaudeEfforts(help: string): AgentEffortLevel[] {
	const choices = /--effort\s+<[^>]*>\s+[^(]*\(([^)]*)\)/.exec(help)?.[1];
	if (choices === undefined) {
		return [];
	}

	return choices
		.split(",")
		.map((choice) => choice.trim())
		.filter((choice) => /^[a-z][a-z0-9]*$/.test(choice))
		.map((effort) => ({ effort, description: "" }));
}

/**
 * Claude Code takes any model name it is given — an alias such as `opus` or a full model id — and
 * has no way to list them, so the settings screen offers a text field rather than a menu.
 */
export function claudeCatalog(help: string): AgentCatalog {
	return { ...emptyCatalog("claude"), efforts: parseClaudeEfforts(help) };
}
