import { Button, Dialog, Input, Switch } from "@cloudflare/kumo";
import {
	ArrowsClockwiseIcon,
	FolderSimpleIcon,
	PaletteIcon,
	RobotIcon,
	XIcon,
	type Icon,
} from "@phosphor-icons/react";
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
import { RepositoryList } from "./RepositoryList.js";
import { fromDraft, isValidName, toDraft, type RepositoryDraft } from "./RepositoryForm.js";
import { SettingRow } from "./SettingRow.js";
import type { AppearanceMode } from "../../../shared/ipc.js";

interface SettingsDialogProps {
	config: Config;
	/** Held by the app, because it applies whether or not this dialog is open. */
	appearance: AppearanceMode;
	onAppearanceChange: (mode: AppearanceMode) => void;
	onSave: (config: Config) => void;
	onClose: () => void;
}

const SECTIONS: Record<string, { label: string; icon: Icon }> = {
	repositories: { label: "Repositories", icon: FolderSimpleIcon },
	agents: { label: "Agents", icon: RobotIcon },
	refreshing: { label: "Refreshing", icon: ArrowsClockwiseIcon },
	appearance: { label: "Appearance", icon: PaletteIcon },
};

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

/**
 * A modal over the main window: a rail of sections on the left and one scrolling pane on the
 * right, so a section can grow without the dialog becoming a wall of headings. Nothing is written
 * until Save; Cancel and the close button throw the draft away.
 */
export function SettingsDialog({
	config,
	appearance,
	onAppearanceChange,
	onSave,
	onClose,
}: SettingsDialogProps): React.JSX.Element {
	const [section, setSection] = useState<Section>("repositories");
	const [draft, setDraft] = useState<Config>(config);
	const [repositories, setRepositories] = useState<RepositoryDraft[]>(
		config.repositories.map(toDraft),
	);
	const [launchAtLogin, setLaunchAtLogin] = useState<boolean | undefined>(undefined);
	const api = useApi();
	const catalogs = useAgentCatalogs();

	useEffect(() => {
		void api.getLaunchAtLogin().then(setLaunchAtLogin, () => setLaunchAtLogin(false));
	}, [api]);

	const valid = repositories.every((entry) => isValidName(entry.name));

	const save = (): void => {
		onSave({ ...draft, repositories: repositories.map((entry) => fromDraft(entry)) });
	};

	return (
		<Dialog.Root open onOpenChange={(open) => !open && onClose()}>
			<Dialog className="settings-dialog" size="xl">
				<Dialog.Title className="visually-hidden">Settings</Dialog.Title>

				<nav className="settings-nav" aria-label="Settings sections">
					<span className="settings-nav-title">Settings</span>
					{Object.entries(SECTIONS).map(([key, { label, icon: Symbol }]) => (
						<button
							key={key}
							type="button"
							className="settings-nav-item"
							aria-current={key === section ? "page" : undefined}
							onClick={() => setSection(key)}
						>
							<Symbol size={15} aria-hidden />
							{label}
						</button>
					))}
				</nav>

				<div className="settings-pane">
					<div className="settings-pane-header">
						<h2 className="settings-heading">{SECTIONS[section]?.label}</h2>
						<Dialog.Close
							render={<button type="button" className="tool-button" aria-label="Close" />}
						>
							<XIcon size={15} aria-hidden />
						</Dialog.Close>
					</div>

					<div className="settings-inner">
						{section === "repositories" ? (
							<RepositoryList repositories={repositories} onChange={setRepositories} />
						) : null}

						{section === "agents" ? (
							<>
								<p className="settings-lede">
									Each job can go to a different agent. {AGENT_LABELS.codex} and{" "}
									{AGENT_LABELS.claude} are driven through their own command line tools, so
									whichever you pick has to be installed and signed in.
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
										</div>
										<SettingRow label="Timeout" description="A run longer than this is stopped.">
											<NumberField
												label="Timeout in minutes"
												unit="min"
												min={1}
												value={draft.profiles[name].timeoutMinutes}
												onChange={(value) =>
													setDraft(withProfile(draft, name, { timeoutMinutes: Math.max(value, 1) }))
												}
											/>
										</SettingRow>
									</div>
								))}

								<div className="settings-card">
									<h3>How many at once</h3>
									<SettingRow
										label="Concurrent agent processes"
										description="One cap across every running job, whichever agent is doing the work."
									>
										<NumberField
											label="Concurrent agent processes"
											min={1}
											value={draft.concurrency}
											onChange={(value) => setDraft({ ...draft, concurrency: Math.max(value, 1) })}
										/>
									</SettingRow>
								</div>
							</>
						) : null}

						{section === "refreshing" ? (
							<>
								<div className="settings-card">
									<h3>Background refresh</h3>
									<SettingRow
										label="Fetch in the background"
										description="Every tracked repository's pull requests. Only fetches, so it costs nothing but a few GitHub requests; nothing is assessed until you ask."
									>
										<Switch
											aria-label="Fetch in the background"
											checked={draft.schedule.enabled}
											onClick={() =>
												setDraft({
													...draft,
													schedule: { ...draft.schedule, enabled: !draft.schedule.enabled },
												})
											}
										/>
									</SettingRow>
									<SettingRow label="Every" disabled={!draft.schedule.enabled}>
										<NumberField
											label="Refresh interval in minutes"
											unit="min"
											min={1}
											value={draft.schedule.intervalMinutes}
											disabled={!draft.schedule.enabled}
											onChange={(value) =>
												setDraft({
													...draft,
													schedule: { ...draft.schedule, intervalMinutes: Math.max(value, 1) },
												})
											}
										/>
									</SettingRow>
								</div>

								<div className="settings-card">
									<h3>What gets assessed</h3>
									<SettingRow
										label="Re-assess after"
										description="An assessment older than this is re-run even when nothing changed."
									>
										<NumberField
											label="Re-assess after this many days"
											unit="days"
											value={draft.outdatedAfterDays}
											onChange={(value) => setDraft({ ...draft, outdatedAfterDays: value })}
										/>
									</SettingRow>
									<SettingRow
										label="Ask before assessing more than"
										description="Assessing more than this many at once asks which of them you want. 0 never asks."
									>
										<NumberField
											label="Ask before assessing more than this many"
											value={draft.confirmAssessmentsAbove}
											onChange={(value) => setDraft({ ...draft, confirmAssessmentsAbove: value })}
										/>
									</SettingRow>
									<SettingRow
										label="Diff cut-off"
										description="Larger diffs are left out and the file list stands in for them."
									>
										<NumberField
											label="Diff cut-off in kilobytes"
											unit="kB"
											value={draft.diffCutoffKb}
											onChange={(value) => setDraft({ ...draft, diffCutoffKb: value })}
										/>
									</SettingRow>
									<SettingRow label="Keep closed pull requests for">
										<NumberField
											label="Keep closed pull requests for this many days"
											unit="days"
											value={draft.closedRetentionDays}
											onChange={(value) => setDraft({ ...draft, closedRetentionDays: value })}
										/>
									</SettingRow>
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
									<SettingRow label="Open PRoctologist when you log in">
										<Switch
											aria-label="Open PRoctologist when you log in"
											checked={launchAtLogin ?? false}
											disabled={launchAtLogin === undefined}
											onClick={() => {
												const next = !(launchAtLogin ?? false);
												setLaunchAtLogin(next);
												// Applied at once: it is an operating system setting, not part of the config file.
												void api.setLaunchAtLogin({ enabled: next });
											}}
										/>
									</SettingRow>
								</div>
							</>
						) : null}
					</div>

					<div className="settings-actions">
						<Button variant="ghost" onClick={onClose}>
							Cancel
						</Button>
						<Button variant="primary" disabled={!valid} onClick={save}>
							Save
						</Button>
					</div>
				</div>
			</Dialog>
		</Dialog.Root>
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

/** A short number with its unit beside it; the label and description live in the row around it. */
function NumberField({
	label,
	unit,
	value,
	min = 0,
	disabled,
	onChange,
}: {
	label: string;
	unit?: string;
	value: number;
	min?: number;
	disabled?: boolean;
	onChange: (value: number) => void;
}): React.JSX.Element {
	return (
		<span className="settings-number">
			<Input
				aria-label={label}
				type="number"
				min={min}
				disabled={disabled}
				value={String(value)}
				onChange={(event) => onChange(Number(event.target.value) || 0)}
			/>
			{unit === undefined ? null : <span className="settings-unit">{unit}</span>}
		</span>
	);
}
