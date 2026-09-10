import { Input, Select } from "@cloudflare/kumo";
import {
	AGENT_KINDS,
	AGENT_LABELS,
	defaultEffortFor,
	effortsFor,
} from "@proctologist/core/browser";
import type { AgentCatalog, AgentCatalogs, AgentKind } from "../../../shared/ipc.js";

export interface AgentProfileValue {
	agent: AgentKind;
	model: string | undefined;
	effort: string;
}

/**
 * `settled` is false while the value is still being typed, so the caller can hold off writing it
 * until the field is left; a pick from a list is settled the moment it is made.
 */
export type AgentProfileChange = (value: AgentProfileValue, settled: boolean) => void;

interface AgentProfileFieldsProps {
	value: AgentProfileValue;
	onChange: AgentProfileChange;
	catalogs: AgentCatalogs | undefined;
	/** Set when no agent could be asked at all, rather than one of them failing. */
	unavailable: string | undefined;
}

/** The empty string stands for "no model named", which every Select needs a real value for. */
const AGENT_DEFAULT = "";

/**
 * An option with a second, quieter line under its name. Only the popup shows it: the trigger
 * renders the name alone, through `renderValue`, so the closed field stays one line tall.
 */
function option(label: string, description: string): React.ReactNode {
	return (
		<span className="select-option">
			<span>{label}</span>
			{description === "" ? null : <span className="select-option-description">{description}</span>}
		</span>
	);
}

/**
 * One row of the settings: which agent runs this job, on which model, and how hard. The models and
 * effort levels come from the installed agents themselves, so they are whatever those actually
 * accept — Codex names its models and gives each its own levels, while Claude Code takes any model
 * name and one list of levels.
 */
export function AgentProfileFields({
	value,
	onChange,
	catalogs,
	unavailable,
}: AgentProfileFieldsProps): React.JSX.Element {
	const catalog = catalogs?.[value.agent];
	const efforts = effortsFor(catalog, value.model);
	const trouble = unavailable ?? catalog?.error ?? undefined;

	/** Moving between agents keeps the effort when the new one has it, and its own default if not. */
	const chooseAgent = (agent: AgentKind): void => {
		const next = catalogs?.[agent];
		const keeps = effortsFor(next, undefined).some((level) => level.effort === value.effort);
		onChange(
			{
				agent,
				// Model names do not carry across agents; each has its own.
				model: undefined,
				effort: keeps ? value.effort : defaultEffortFor(next, undefined, value.effort),
			},
			true,
		);
	};

	return (
		<>
			<Select
				label="Agent"
				description={trouble}
				error={trouble}
				value={value.agent}
				onValueChange={(next) => next !== null && chooseAgent(next as AgentKind)}
				items={Object.fromEntries(AGENT_KINDS.map((kind) => [kind, AGENT_LABELS[kind]]))}
			/>
			<ModelField
				value={value}
				onChange={onChange}
				catalog={catalog}
				open={catalog === undefined || catalog.openModels || catalog.models.length === 0}
			/>
			<EffortField value={value} onChange={onChange} catalog={catalog} efforts={efforts} />
		</>
	);
}

interface FieldProps {
	value: AgentProfileValue;
	onChange: AgentProfileChange;
	catalog: AgentCatalog | undefined;
}

function ModelField({ value, onChange, catalog, open }: FieldProps & { open: boolean }) {
	const label = AGENT_LABELS[value.agent];

	if (open) {
		return (
			<Input
				label="Model"
				required={false}
				description={`Left empty, ${label} picks its own.`}
				value={value.model ?? ""}
				placeholder={`${label} default`}
				onChange={(event) => onChange({ ...value, model: event.target.value || undefined }, false)}
			/>
		);
	}

	const models = catalog?.models ?? [];
	// A model set in the config file but missing from the catalog still needs to be selectable.
	const known = models.some((model) => model.slug === value.model);
	const choices = [
		...models.filter((model) => model.listed || model.slug === value.model),
		...(value.model !== undefined && !known
			? [{ slug: value.model, displayName: value.model, description: `Not in this ${label}.` }]
			: []),
	];
	const names = new Map<string, string>([
		[AGENT_DEFAULT, `${label} default`],
		...choices.map((model): [string, string] => [model.slug, model.displayName]),
	]);

	return (
		<Select
			label="Model"
			value={value.model ?? AGENT_DEFAULT}
			// The empty string counts as nothing selected, so the default is spelled out as a placeholder.
			placeholder={`${label} default`}
			renderValue={(slug: string) => names.get(slug) ?? slug}
			onValueChange={(next) => {
				const model = next === AGENT_DEFAULT || next === null ? undefined : next;
				const keeps = effortsFor(catalog, model).some((level) => level.effort === value.effort);
				onChange(
					{
						...value,
						model,
						// The chosen level may not exist on the new model, so fall back to its own default.
						effort: keeps ? value.effort : defaultEffortFor(catalog, model, value.effort),
					},
					true,
				);
			}}
			items={{
				[AGENT_DEFAULT]: option(`${label} default`, `Whatever ${label} picks on its own today.`),
				...Object.fromEntries(
					// For an alias the description is the model it stands for today, which is the whole
					// reason to pick an alias over a pinned name.
					choices.map((model) => [model.slug, option(model.displayName, model.description)]),
				),
			}}
		/>
	);
}

function EffortField({
	value,
	onChange,
	catalog,
	efforts,
}: FieldProps & { efforts: { effort: string; description: string }[] }) {
	if (efforts.length === 0) {
		return (
			<Input
				label="Effort"
				value={value.effort}
				onChange={(event) => onChange({ ...value, effort: event.target.value }, false)}
			/>
		);
	}

	const selected = catalog?.models.find((model) => model.slug === value.model);

	return (
		<Select
			label="Effort"
			description={
				selected
					? `${selected.displayName} defaults to ${selected.defaultEffort}.`
					: `Levels ${AGENT_LABELS[value.agent]} accepts.`
			}
			value={value.effort}
			renderValue={(effort: string) => effort}
			onValueChange={(next) => onChange({ ...value, effort: next ?? value.effort }, true)}
			items={Object.fromEntries(
				efforts.map((level) => [level.effort, option(level.effort, level.description)]),
			)}
		/>
	);
}
