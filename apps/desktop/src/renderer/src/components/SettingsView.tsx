import { Button, Input, Switch } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import {
	AGENT_LABELS,
	PROFILE_NAMES,
	type Config,
	type ProfileName,
} from "@proctologist/core/browser";
import { useApi } from "../api.js";
import { useAgentCatalogs } from "../state/useData.js";
import { AgentProfileFields } from "./AgentProfileFields.js";
import { AppearanceSwitcher } from "./AppearanceSwitcher.js";
import {
	EMPTY_DRAFT,
	RepositoryForm,
	fromDraft,
	isValidName,
	toDraft,
	type RepositoryDraft,
} from "./RepositoryForm.js";
import type { AppearanceMode } from "../../../shared/ipc.js";

interface SettingsViewProps {
	config: Config;
	/** Held by the app, because it applies whether or not this screen is open. */
	appearance: AppearanceMode;
	onAppearanceChange: (mode: AppearanceMode) => void;
	onSave: (config: Config) => void;
	onClose: () => void;
}

const SECTIONS = {
	repositories: "Repositories",
	agents: "Agents",
	refreshing: "Refreshing",
	appearance: "Appearance",
} as const;

type Section = keyof typeof SECTIONS;

/** What each profile is for, in the user's terms rather than the config file's. */
const PROFILES: Record<ProfileName, { title: string; description: string }> = {
	assess: {
		title: "Quick assessment",
		description:
			"Every pull request, on every refresh. Reads the pull request and the default branch.",
	},
	thorough: {
		title: "Thorough assessment",
		description: "One pull request at a time, on request. Works in a checkout of its head commit.",
	},
	review: {
		title: "Review draft",
		description: "Writes a review for you to read and post yourself. The longest and priciest job.",
	},
};

export function SettingsView({
	config,
	appearance,
	onAppearanceChange,
	onSave,
	onClose,
}: SettingsViewProps): React.JSX.Element {
	const [section, setSection] = useState<Section>("repositories");
	const [draft, setDraft] = useState<Config>(config);
	const [repositories, setRepositories] = useState<RepositoryDraft[]>(
		config.repositories.map(toDraft),
	);
	const [added, setAdded] = useState<RepositoryDraft>(EMPTY_DRAFT);
	const [launchAtLogin, setLaunchAtLogin] = useState<boolean | undefined>(undefined);
	const api = useApi();
	const catalogs = useAgentCatalogs();

	useEffect(() => {
		void api.getLaunchAtLogin().then(setLaunchAtLogin, () => setLaunchAtLogin(false));
	}, [api]);

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
			<nav className="settings-nav" aria-label="Settings sections">
				{Object.entries(SECTIONS).map(([key, label]) => (
					<button
						key={key}
						type="button"
						className="settings-nav-item"
						aria-current={key === section ? "page" : undefined}
						onClick={() => setSection(key as Section)}
					>
						{label}
					</button>
				))}
			</nav>

			<div className="settings-pane">
				<div className="settings-inner">
					<h2 className="settings-heading">{SECTIONS[section]}</h2>

					{section === "repositories" ? (
						<>
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
											onClick={() =>
												setRepositories(repositories.filter((_item, i) => i !== index))
											}
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
						</>
					) : null}

					{section === "agents" ? (
						<>
							<p className="settings-lede">
								Each job can go to a different agent. {AGENT_LABELS.codex} and {AGENT_LABELS.claude}{" "}
								are driven through their own command line tools, so whichever you pick has to be
								installed and signed in.
							</p>
							{PROFILE_NAMES.map((name) => (
								<div key={name} className="settings-card">
									<h3>{PROFILES[name].title}</h3>
									<p className="settings-note">{PROFILES[name].description}</p>
									<div className="settings-profile">
										<AgentProfileFields
											value={{
												agent: draft.profiles[name].agent,
												model: draft.profiles[name].model,
												effort: draft.profiles[name].effort,
											}}
											onChange={(value) => setDraft(withProfile(draft, name, value))}
											catalogs={catalogs.value}
											unavailable={catalogs.error}
										/>
										<Input
											label="Timeout (minutes)"
											type="number"
											min={1}
											value={String(draft.profiles[name].timeoutMinutes)}
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

							<div className="settings-card">
								<h3>How many at once</h3>
								<div className="form-grid">
									<NumberField
										label="Concurrent agent processes"
										description="One cap across every running job, whichever agent is doing the work."
										value={draft.concurrency}
										onChange={(value) => setDraft({ ...draft, concurrency: value })}
									/>
								</div>
							</div>
						</>
					) : null}

					{section === "refreshing" ? (
						<>
							<div className="settings-card">
								<h3>Background refresh</h3>
								<Switch
									label="Fetch every tracked repository's pull requests in the background"
									checked={draft.schedule.enabled}
									onClick={() =>
										setDraft({
											...draft,
											schedule: { ...draft.schedule, enabled: !draft.schedule.enabled },
										})
									}
								/>
								<NumberField
									label="Every (minutes)"
									description="Only fetches, so it costs nothing but a few GitHub requests. Nothing is assessed until you ask."
									value={draft.schedule.intervalMinutes}
									disabled={!draft.schedule.enabled}
									onChange={(value) =>
										setDraft({
											...draft,
											schedule: { ...draft.schedule, intervalMinutes: value },
										})
									}
								/>
							</div>

							<div className="settings-card">
								<h3>What gets assessed</h3>
								<div className="form-grid">
									<NumberField
										label="Re-assess after (days)"
										description="An assessment older than this is re-run even when nothing changed."
										value={draft.outdatedAfterDays}
										onChange={(value) => setDraft({ ...draft, outdatedAfterDays: value })}
									/>
									<NumberField
										label="Ask before assessing more than"
										description="Assessing more than this many at once asks which of them you want. 0 never asks."
										value={draft.confirmAssessmentsAbove}
										onChange={(value) => setDraft({ ...draft, confirmAssessmentsAbove: value })}
									/>
									<NumberField
										label="Diff cut-off (kB)"
										description="Larger diffs are left out and the file list stands in for them."
										value={draft.diffCutoffKb}
										onChange={(value) => setDraft({ ...draft, diffCutoffKb: value })}
									/>
									<NumberField
										label="Keep closed pull requests for (days)"
										value={draft.closedRetentionDays}
										onChange={(value) => setDraft({ ...draft, closedRetentionDays: value })}
									/>
								</div>
							</div>
						</>
					) : null}

					{section === "appearance" ? (
						<>
							<div className="settings-card">
								<h3>Theme</h3>
								<AppearanceSwitcher mode={appearance} onChange={onAppearanceChange} />
							</div>

							<div className="settings-card">
								<h3>Startup</h3>
								<Switch
									label="Open PRoctologist when you log in"
									checked={launchAtLogin ?? false}
									disabled={launchAtLogin === undefined}
									onClick={() => {
										const next = !(launchAtLogin ?? false);
										setLaunchAtLogin(next);
										// Applied at once: it is an operating system setting, not part of the config file.
										void api.setLaunchAtLogin({ enabled: next });
									}}
								/>
							</div>
						</>
					) : null}

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
		</div>
	);
}

function withProfile(
	config: Config,
	name: ProfileName,
	patch: Partial<Config["profiles"][ProfileName]>,
): Config {
	return {
		...config,
		profiles: {
			...config.profiles,
			[name]: { ...config.profiles[name], ...patch },
		},
	};
}

function NumberField({
	label,
	description,
	value,
	disabled,
	onChange,
}: {
	label: string;
	description?: string;
	value: number;
	disabled?: boolean;
	onChange: (value: number) => void;
}): React.JSX.Element {
	return (
		<Input
			label={label}
			description={description}
			type="number"
			min={0}
			disabled={disabled}
			value={String(value)}
			onChange={(event) => onChange(Number(event.target.value) || 0)}
		/>
	);
}
