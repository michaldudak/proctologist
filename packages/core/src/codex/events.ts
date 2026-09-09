/**
 * The JSONL events `codex exec --json` prints. Only the fields the app uses are described; Codex
 * adds more over time and unknown events are ignored rather than rejected.
 */
export interface CodexEvent {
	type: string;
	thread_id?: string;
	item?: {
		id?: string;
		type?: string;
		text?: string;
		command?: string;
		status?: string;
		exit_code?: number | null;
	};
	usage?: Record<string, number>;
}

export interface CodexUsage {
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	reasoningOutputTokens: number;
}

/** Progress worth showing while a job runs. */
export type CodexProgress =
	| { kind: "session"; sessionId: string }
	| { kind: "message"; text: string }
	| { kind: "command"; command: string; status: "started" | "finished"; exitCode?: number | null }
	| { kind: "turn_completed"; usage: CodexUsage | null };

export function parseEvent(line: string): CodexEvent | undefined {
	const trimmed = line.trim();
	if (trimmed === "" || !trimmed.startsWith("{")) {
		return undefined;
	}
	try {
		return JSON.parse(trimmed) as CodexEvent;
	} catch {
		return undefined;
	}
}

export function toProgress(event: CodexEvent): CodexProgress | undefined {
	switch (event.type) {
		case "thread.started": {
			return event.thread_id ? { kind: "session", sessionId: event.thread_id } : undefined;
		}
		case "item.started":
		case "item.completed": {
			const item = event.item;
			if (item?.type === "command_execution" && item.command) {
				return {
					kind: "command",
					command: item.command,
					status: event.type === "item.started" ? "started" : "finished",
					exitCode: item.exit_code ?? null,
				};
			}
			if (event.type === "item.completed" && item?.type === "agent_message" && item.text) {
				return { kind: "message", text: item.text };
			}
			return undefined;
		}
		case "turn.completed": {
			return { kind: "turn_completed", usage: toUsage(event.usage) };
		}
		default: {
			return undefined;
		}
	}
}

function toUsage(usage: Record<string, number> | undefined): CodexUsage | null {
	if (!usage) {
		return null;
	}
	return {
		inputTokens: usage["input_tokens"] ?? 0,
		cachedInputTokens: usage["cached_input_tokens"] ?? 0,
		outputTokens: usage["output_tokens"] ?? 0,
		reasoningOutputTokens: usage["reasoning_output_tokens"] ?? 0,
	};
}
