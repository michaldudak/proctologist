/**
 * Everything specific to the Claude Code CLI: how `claude -p` is spelled, the JSONL messages
 * `--output-format stream-json` prints, and the effort levels the installed CLI accepts. Only the
 * fields the app uses are described; unknown messages are ignored rather than rejected.
 */
import type { AgentCatalog, AgentEffortLevel, AgentModel } from "./catalog.js";
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
		];

		if (run.profile.effort !== undefined) {
			args.push("--effort", run.profile.effort);
		}
		if (run.profile.model) {
			args.push("--model", run.profile.model);
		}
		if (run.sandbox === "read-only") {
			args.push("--disallowed-tools", ...READ_ONLY_TOOLS_DENIED);
		}
		if (run.schema !== undefined) {
			// Claude takes the schema itself rather than a path to one, so the file goes unused.
			args.push("--json-schema", JSON.stringify(withoutMetaSchema(run.schema)));
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
					// Only `init` names the model; the closing `result` message does not carry one.
					return message.session_id
						? { kind: "session", sessionId: message.session_id, model: message.model ?? null }
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

/**
 * Drops the top-level `$schema`. Zod stamps every schema it generates with the 2020-12 meta-schema
 * URL, and Claude Code's validator rejects a schema that names a meta-schema it does not hold —
 * `no schema with key or ref "https://json-schema.org/draft/2020-12/schema"`. The schema itself is
 * fine; only the declaration is unwelcome, so it goes rather than the app keeping a second one.
 */
function withoutMetaSchema(schema: unknown): unknown {
	if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
		return schema;
	}
	const { $schema: _dropped, ...rest } = schema as Record<string, unknown>;
	return rest;
}

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

/** The shape of the model catalog Claude Code caches. Only the fields the app uses are described. */
interface PublishedCatalog {
	document?: {
		surfaces?: Record<
			string,
			{
				model_selector_config?: {
					models?: {
						id?: string;
						name?: string;
						short_name?: string;
						description?: string;
						/** `main` is what its own picker shows; `overflow` is the "more models" list. */
						section?: string;
						min_claude_code_version?: string | null;
						thinking?: {
							effort_options?: { id?: string; name?: string; badge?: { message?: string } }[];
						} | null;
					}[];
					/** `sonnet`, `opus` and friends, each naming the model it currently resolves to. */
					provider_alias_targets?: Record<string, { default?: string }>;
				}[];
			}
		>;
	};
}

/** What the app can find out about the installed Claude Code, however it found it out. */
export interface ClaudeSources {
	/** Output of `claude --help`, for the effort levels every model shares. */
	help: string;
	/** Output of `claude --version`, so models this build is too old for are not offered. */
	version?: string | undefined;
	/** The cached catalog document, when one could be read. */
	catalog?: string | undefined;
}

/**
 * What the installed Claude Code can do. The effort levels come from its `--help`, which is a
 * supported interface; the models come from the catalog it caches for its own `/model` picker,
 * which is not. There is no `claude debug models`, and hardcoding a model list would be wrong
 * within a release or two, so the cache is read for what it is worth and the settings screen falls
 * back to a plain text field whenever it cannot be read or understood.
 */
export function claudeCatalog(sources: ClaudeSources): AgentCatalog {
	const efforts = parseClaudeEfforts(sources.help);
	const models =
		sources.catalog === undefined ? [] : parseClaudeModels(sources.catalog, sources.version);

	return {
		agent: "claude",
		models,
		efforts,
		openModels: models.length === 0,
		error: null,
	};
}

/** Reads the models out of a cached catalog document. Anything unexpected yields no models. */
export function parseClaudeModels(catalog: string, version?: string | undefined): AgentModel[] {
	let config;
	try {
		const parsed = JSON.parse(catalog) as PublishedCatalog;
		// `cc` is Claude Code's own surface; the others belong to the apps around it.
		config = parsed.document?.surfaces?.["cc"]?.model_selector_config?.[0];
	} catch {
		return [];
	}
	if (!config?.models) {
		return [];
	}

	const installed = parseVersion(version);
	const byId = new Map<string, AgentModel>();

	for (const model of config.models) {
		if (!model.id) {
			continue;
		}
		const levels = (model.thinking?.effort_options ?? []).flatMap((option) =>
			option.id ? [{ effort: option.id, description: labelFor(option.id, option.name) }] : [],
		);
		const badged = (model.thinking?.effort_options ?? []).find(
			(option) => option.badge?.message === "Default",
		)?.id;

		byId.set(model.id, {
			slug: model.id,
			displayName: model.name ?? model.id,
			description: model.description ?? "",
			defaultEffort: badged ?? levels[Math.floor(levels.length / 2)]?.effort ?? "medium",
			efforts: levels,
			// The overflow section is what its own picker hides behind "more models"; a model this
			// build predates would be rejected outright, so neither is offered by default.
			listed: model.section === "main" && supports(installed, model.min_claude_code_version),
		});
	}

	// An alias tracks whichever model it currently points at, which is what most people want to
	// pin: `sonnet` stays sensible across releases where `claude-sonnet-5` will not. They go first
	// because they are the better default choice, not merely another entry.
	const aliases = Object.entries(config.provider_alias_targets ?? {}).flatMap(([alias, target]) => {
		const model = target.default === undefined ? undefined : byId.get(target.default);
		return model
			? [
					{
						...model,
						slug: alias,
						displayName: `${alias[0]?.toUpperCase() ?? ""}${alias.slice(1)} (latest)`,
						description: `Currently ${model.displayName}.`,
					},
				]
			: [];
	});

	return [...aliases, ...byId.values()];
}

/**
 * Most of Claude Code's effort names are its own ids capitalised — `medium` is called "Medium" —
 * which as a label beside the id reads as noise. Only a name that says something the id does not,
 * such as `xhigh` being "Extra", is worth showing.
 */
function labelFor(effort: string, name: string | undefined): string {
	return name === undefined || name.toLowerCase() === effort.toLowerCase() ? "" : name;
}

/** `2.1.267 (Claude Code)` and friends; anything unreadable counts as new enough. */
function parseVersion(version: string | undefined): number[] | undefined {
	const found = version === undefined ? null : /(\d+)\.(\d+)\.(\d+)/.exec(version);
	return found ? [Number(found[1]), Number(found[2]), Number(found[3])] : undefined;
}

function supports(installed: number[] | undefined, minimum: string | null | undefined): boolean {
	const needed = parseVersion(minimum ?? undefined);
	if (!installed || !needed) {
		return true;
	}
	for (const [index, part] of needed.entries()) {
		const have = installed[index] ?? 0;
		if (have !== part) {
			return have > part;
		}
	}
	return true;
}
