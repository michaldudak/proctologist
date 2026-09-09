import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface CodexReasoningLevel {
	effort: string;
	description: string;
}

export interface CodexModel {
	slug: string;
	displayName: string;
	description: string;
	/** The effort Codex itself picks for this model. */
	defaultEffort: string;
	/** Reasoning levels this model accepts. They differ per model, so this is not a global list. */
	efforts: CodexReasoningLevel[];
	/** False for models Codex keeps out of its own pickers. */
	listed: boolean;
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

export interface CatalogOptions {
	codexPath?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}

/**
 * Asks the Codex CLI which models and reasoning levels it accepts.
 *
 * Reading them from Codex rather than hardcoding a list is the whole point: the models change with
 * every Codex release, and which efforts a model takes differs between them.
 */
export async function readModelCatalog(options: CatalogOptions = {}): Promise<CodexModel[]> {
	const { stdout } = await run(options.codexPath ?? "codex", ["debug", "models"], {
		env: options.env ?? process.env,
		timeout: options.timeoutMs ?? 15_000,
		maxBuffer: 32 * 1024 * 1024,
	});

	return parseModelCatalog(stdout);
}

/** Split out from the process call so it can be tested against a recorded catalog. */
export function parseModelCatalog(json: string): CodexModel[] {
	const raw = JSON.parse(json) as RawCatalog;

	return (raw.models ?? []).flatMap((model) => {
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
}

/**
 * The reasoning levels a model takes, or every level in the catalog when the model is unknown —
 * which is what happens for an empty setting, meaning "let Codex choose".
 */
export function effortsFor(models: CodexModel[], slug: string | undefined): CodexReasoningLevel[] {
	const model = slug === undefined ? undefined : models.find((item) => item.slug === slug);
	if (model) {
		return model.efforts;
	}

	const seen = new Map<string, CodexReasoningLevel>();
	for (const level of models.flatMap((item) => item.efforts)) {
		if (!seen.has(level.effort)) {
			seen.set(level.effort, level);
		}
	}
	return [...seen.values()];
}
