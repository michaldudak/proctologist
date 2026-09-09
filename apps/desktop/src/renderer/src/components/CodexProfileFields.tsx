import { Input, Select } from "@cloudflare/kumo";
import { effortsFor } from "@proctologist/core/browser";
import type { CodexModel } from "../../../shared/ipc.js";

export interface CodexProfileValue {
	model: string | undefined;
	reasoningEffort: string;
}

interface CodexProfileFieldsProps {
	value: CodexProfileValue;
	onChange: (value: CodexProfileValue) => void;
	models: CodexModel[];
	/** Set when Codex could not be asked; the fields fall back to free text. */
	unavailable: string | undefined;
}

const CODEX_DEFAULT = "";

/**
 * The model and reasoning level come from `codex debug models`, so they are whatever the installed
 * Codex actually accepts. Which levels exist differs per model, so choosing a model narrows them.
 */
export function CodexProfileFields({
	value,
	onChange,
	models,
	unavailable,
}: CodexProfileFieldsProps): React.JSX.Element {
	if (unavailable !== undefined || models.length === 0) {
		return (
			<>
				<Input
					label="Model"
					required={false}
					description={unavailable ?? "Left empty, Codex picks its own."}
					value={value.model ?? ""}
					placeholder="Codex default"
					onChange={(event) =>
						onChange({
							...value,
							model: event.target.value === "" ? undefined : event.target.value,
						})
					}
				/>
				<Input
					label="Reasoning effort"
					value={value.reasoningEffort}
					onChange={(event) => onChange({ ...value, reasoningEffort: event.target.value })}
				/>
			</>
		);
	}

	// A model set in the config file but missing from the catalog still needs to be selectable.
	const known = models.some((model) => model.slug === value.model);
	const choices = [
		...models.filter((model) => model.listed || model.slug === value.model),
		...(value.model !== undefined && !known
			? [{ slug: value.model, displayName: `${value.model} (not in this Codex)` }]
			: []),
	];

	const efforts = effortsFor(models, value.model);
	const selected = models.find((model) => model.slug === value.model);

	return (
		<>
			<Select
				label="Model"
				value={value.model ?? CODEX_DEFAULT}
				onValueChange={(next) => {
					const model = next === CODEX_DEFAULT || next === null ? undefined : next;
					const supported = effortsFor(models, model);
					const keeps = supported.some((level) => level.effort === value.reasoningEffort);
					onChange({
						model,
						// The chosen level may not exist on the new model, so fall back to its own default.
						reasoningEffort: keeps
							? value.reasoningEffort
							: (models.find((item) => item.slug === model)?.defaultEffort ??
								value.reasoningEffort),
					});
				}}
				items={{
					[CODEX_DEFAULT]: "Codex default",
					...Object.fromEntries(choices.map((model) => [model.slug, model.displayName])),
				}}
			/>
			<Select
				label="Reasoning effort"
				description={
					selected
						? `${selected.displayName} defaults to ${selected.defaultEffort}.`
						: "Levels offered by every model Codex has."
				}
				value={value.reasoningEffort}
				onValueChange={(next) =>
					onChange({ ...value, reasoningEffort: next ?? value.reasoningEffort })
				}
				items={Object.fromEntries(
					efforts.map((level) => [
						level.effort,
						level.description === "" ? level.effort : `${level.effort} — ${level.description}`,
					]),
				)}
			/>
		</>
	);
}
