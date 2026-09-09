import { Button, Input, Select, Switch } from "@cloudflare/kumo";
import { useState } from "react";
import {
	CODEX_PROFILE_NAMES,
	REASONING_EFFORTS,
	type CodexProfileName,
	type Config,
	type ReasoningEffort,
} from "@proctologist/core/browser";
import {
	EMPTY_DRAFT,
	RepositoryForm,
	fromDraft,
	isValidName,
	toDraft,
	type RepositoryDraft,
} from "./RepositoryForm.js";

interface SettingsViewProps {
	config: Config;
	onSave: (config: Config) => void;
	onClose: () => void;
}

const PROFILE_LABELS: Record<CodexProfileName, string> = {
	assess: "Quick assessment",
	thorough: "Thorough assessment",
	review: "Review draft",
};

export function SettingsView({ config, onSave, onClose }: SettingsViewProps): React.JSX.Element {
	const [draft, setDraft] = useState<Config>(config);
	const [repositories, setRepositories] = useState<RepositoryDraft[]>(
		config.repositories.map(toDraft),
	);
	const [added, setAdded] = useState<RepositoryDraft>(EMPTY_DRAFT);

	const valid =
		repositories.every((entry) => isValidName(entry.name)) &&
		(added.name.trim() === "" || isValidName(added.name));

	const save = (): void => {
		const all = [...repositories];
		if (added.name.trim() !== "") {
			all.push(added);
		}
		onSave({ ...draft, repositories: all.map((entry) => fromDraft(entry)) });
	};

	return (
		<div className="settings">
			<div className="settings-inner">
				<section className="settings-section">
					<h2>Repositories</h2>
					{repositories.map((entry, index) => (
						<div key={entry.name || String(index)} className="settings-card">
							<RepositoryForm
								draft={entry}
								nameEditable={false}
								onChange={(next) =>
									setRepositories(repositories.map((item, i) => (i === index ? next : item)))
								}
							/>
							<div className="filter-row">
								<Button
									size="xs"
									variant="secondary-destructive"
									onClick={() => setRepositories(repositories.filter((_item, i) => i !== index))}
								>
									Stop tracking {entry.name}
								</Button>
							</div>
						</div>
					))}

					<div className="settings-card">
						<h3>Add a repository</h3>
						<RepositoryForm draft={added} nameEditable onChange={setAdded} />
					</div>
				</section>

				<section className="settings-section">
					<h2>Schedule</h2>
					<Switch
						label="Refresh every tracked repository once a day"
						checked={draft.schedule.enabled}
						onClick={() =>
							setDraft({
								...draft,
								schedule: { ...draft.schedule, enabled: !draft.schedule.enabled },
							})
						}
					/>
					<Input
						label="Time"
						description="In this machine's own time zone."
						type="time"
						value={draft.schedule.time}
						disabled={!draft.schedule.enabled}
						onChange={(event) =>
							setDraft({
								...draft,
								schedule: { ...draft.schedule, time: event.target.value },
							})
						}
					/>
				</section>

				<section className="settings-section">
					<h2>Codex profiles</h2>
					{CODEX_PROFILE_NAMES.map((name) => (
						<div key={name} className="settings-card">
							<h3>{PROFILE_LABELS[name]}</h3>
							<div className="form-grid">
								<Input
									label="Model"
									required={false}
									description="Left empty, Codex picks its own."
									value={draft.codexProfiles[name].model ?? ""}
									placeholder="Codex default"
									onChange={(event) =>
										setDraft(
											withProfile(draft, name, {
												model: event.target.value === "" ? undefined : event.target.value,
											}),
										)
									}
								/>
								<Select
									label="Reasoning effort"
									value={draft.codexProfiles[name].reasoningEffort}
									onValueChange={(value) =>
										setDraft(
											withProfile(draft, name, {
												reasoningEffort: (value as ReasoningEffort | null) ?? "medium",
											}),
										)
									}
									items={Object.fromEntries(REASONING_EFFORTS.map((level) => [level, level]))}
								/>
								<Input
									label="Timeout (minutes)"
									type="number"
									min={1}
									value={String(draft.codexProfiles[name].timeoutMinutes)}
									onChange={(event) =>
										setDraft(
											withProfile(draft, name, {
												timeoutMinutes: Number(event.target.value) || 1,
											}),
										)
									}
								/>
							</div>
						</div>
					))}
				</section>

				<section className="settings-section">
					<h2>Defaults</h2>
					<div className="form-grid">
						<NumberField
							label="Concurrent Codex processes"
							value={draft.concurrency}
							onChange={(value) => setDraft({ ...draft, concurrency: value })}
						/>
						<NumberField
							label="Re-assess after (days)"
							description="An assessment older than this is re-run even when nothing changed."
							value={draft.outdatedAfterDays}
							onChange={(value) => setDraft({ ...draft, outdatedAfterDays: value })}
						/>
						<NumberField
							label="Keep closed pull requests for (days)"
							value={draft.closedRetentionDays}
							onChange={(value) => setDraft({ ...draft, closedRetentionDays: value })}
						/>
						<NumberField
							label="Diff cut-off (kB)"
							description="Larger diffs are left out and the file list stands in for them."
							value={draft.diffCutoffKb}
							onChange={(value) => setDraft({ ...draft, diffCutoffKb: value })}
						/>
					</div>
				</section>

				<div className="settings-actions">
					<Button variant="ghost" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!valid} onClick={save}>
						Save
					</Button>
				</div>
			</div>
		</div>
	);
}

function withProfile(
	config: Config,
	name: CodexProfileName,
	patch: Partial<Config["codexProfiles"][CodexProfileName]>,
): Config {
	return {
		...config,
		codexProfiles: {
			...config.codexProfiles,
			[name]: { ...config.codexProfiles[name], ...patch },
		},
	};
}

function NumberField({
	label,
	description,
	value,
	onChange,
}: {
	label: string;
	description?: string;
	value: number;
	onChange: (value: number) => void;
}): React.JSX.Element {
	return (
		<Input
			label={label}
			description={description}
			type="number"
			min={0}
			value={String(value)}
			onChange={(event) => onChange(Number(event.target.value) || 0)}
		/>
	);
}
