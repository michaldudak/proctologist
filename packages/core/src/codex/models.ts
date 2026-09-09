/**
 * The shape of the Codex model catalog, and the pure functions over it. Kept apart from the
 * process that produces it so the renderer can use these without pulling in child_process.
 */

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

/** Parses what `codex debug models` prints. */
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
