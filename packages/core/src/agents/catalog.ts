/**
 * What an installed agent says it can do. Reading this from the agent rather than hardcoding a
 * list is the whole point: models and effort levels change with every release, and which levels a
 * model takes differs between them.
 *
 * These are the pure shapes and the functions over them, kept apart from the processes that
 * produce them so the renderer can use them without pulling in child_process.
 */
import type { AgentKind } from "./types.js";

export interface AgentEffortLevel {
	effort: string;
	description: string;
}

export interface AgentModel {
	slug: string;
	displayName: string;
	description: string;
	/** The effort the agent itself picks for this model. */
	defaultEffort: string;
	/** Effort levels this model accepts, when the agent reports them per model. */
	efforts: AgentEffortLevel[];
	/** False for models the agent keeps out of its own pickers. */
	listed: boolean;
}

export interface AgentCatalog {
	agent: AgentKind;
	models: AgentModel[];
	/** Levels that hold whatever the model is, for agents whose levels do not vary by model. */
	efforts: AgentEffortLevel[];
	/**
	 * True when the agent takes any model name it is given, so the settings screen offers a text
	 * field rather than a closed list.
	 */
	openModels: boolean;
	/** Why the agent could not be asked, when it could not. The screen still works without it. */
	error: string | null;
}

export function emptyCatalog(agent: AgentKind, error: string | null = null): AgentCatalog {
	return { agent, models: [], efforts: [], openModels: true, error };
}

/**
 * The effort levels a model takes: its own when the agent reports them per model, and the
 * catalog's own list otherwise — which is also what an empty model setting gets, meaning "let the
 * agent choose".
 */
export function effortsFor(
	catalog: AgentCatalog | undefined,
	model: string | undefined,
): AgentEffortLevel[] {
	if (!catalog) {
		return [];
	}

	const chosen = model === undefined ? undefined : catalog.models.find((it) => it.slug === model);
	if (chosen && chosen.efforts.length > 0) {
		return chosen.efforts;
	}
	if (catalog.efforts.length > 0) {
		return catalog.efforts;
	}

	const seen = new Map<string, AgentEffortLevel>();
	for (const level of catalog.models.flatMap((it) => it.efforts)) {
		if (!seen.has(level.effort)) {
			seen.set(level.effort, level);
		}
	}
	return [...seen.values()];
}

/** The effort a model prefers, so switching model can move off a level it does not accept. */
export function defaultEffortFor(
	catalog: AgentCatalog | undefined,
	model: string | undefined,
	fallback: string,
): string {
	const chosen =
		model === undefined ? undefined : catalog?.models.find((item) => item.slug === model);
	if (chosen) {
		return chosen.defaultEffort;
	}
	const levels = effortsFor(catalog, model);
	return levels.some((level) => level.effort === fallback)
		? fallback
		: (levels[Math.floor(levels.length / 2)]?.effort ?? fallback);
}
