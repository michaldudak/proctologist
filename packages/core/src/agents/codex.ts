/**
 * Everything specific to the Codex CLI: how `codex exec` is spelled, the JSONL events it prints,
 * and the model catalog `codex debug models` returns. Only the fields the app uses are described;
 * Codex adds more over time and unknown events are ignored rather than rejected.
 */
import type { AgentCatalog, AgentModel } from "./catalog.js";
import type { AgentDialect, AgentProgress, AgentUsage } from "./types.js";

interface CodexEvent {
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

export const codexDialect: AgentDialect = {
	kind: "codex",
	writesMessageFile: true,

	args: (run, files) => {
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
			`model_reasoning_effort="${run.profile.effort}"`,
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
	},

	// Every Codex event stands on its own, so the reader keeps nothing between lines.
	reader: () => (line) => {
		const event = parseEvent(line);
		return event ? toProgress(event) : undefined;
	},
};

function parseEvent(line: string): CodexEvent | undefined {
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

function toProgress(event: CodexEvent): AgentProgress | undefined {
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

function toUsage(usage: Record<string, number> | undefined): AgentUsage | null {
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

interface RawCatalog {
	models?: {
		slug?: string;
		display_name?: string;
		description?: string;
		default_reasoning_level?: string;
		supported_reasoning_levels?: { effort?: string; description?: string }[];
		visibility?: string;
	}[];
}

/** Parses what `codex debug models` prints. */
export function parseCodexCatalog(json: string): AgentCatalog {
	const raw = JSON.parse(json) as RawCatalog;

	const models: AgentModel[] = (raw.models ?? []).flatMap((model) => {
		if (!model.slug) {
			return [];
		}
		const efforts = (model.supported_reasoning_levels ?? []).flatMap((level) =>
			level.effort ? [{ effort: level.effort, description: level.description ?? "" }] : [],
		);

		return [
			{
				slug: model.slug,
				displayName: model.display_name ?? model.slug,
				description: model.description ?? "",
				defaultEffort: model.default_reasoning_level ?? efforts[0]?.effort ?? "medium",
				efforts,
				listed: model.visibility !== "hide",
			},
		];
	});

	// Codex names its models, and the levels differ between them, so there is no catalog-wide list.
	return { agent: "codex", models, efforts: [], openModels: false, error: null };
}
