import { Button } from "@cloudflare/kumo";
import { GearSixIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import { effortsFor, type ItemKind } from "@proctologist/core/browser";
import type { AssessmentQuestion } from "../../shared/ipc.js";
import { useApi } from "./api.js";
import { AssessmentDialog } from "./components/AssessmentDialog.js";
import { Header } from "./components/Header.js";
import { isActiveJob } from "./lib/jobs.js";
import { ItemsPage } from "./components/ItemsPage.js";
import { JobsPanel } from "./components/JobsPanel.js";
import { Rail } from "./components/Rail.js";
import { RefreshControl } from "./components/RefreshControl.js";
import { SettingsDialog } from "./components/SettingsDialog.js";
import { Tool } from "./components/Tool.js";
import { useAppearance } from "./state/useAppearance.js";
import { usePanelWidth } from "./state/usePanelWidth.js";
import { useAgentCatalogs, useConfig, useJobs, useRepositories } from "./state/useData.js";

export function App(): React.JSX.Element {
	const api = useApi();
	const repositories = useRepositories();
	// Null is the All scope. The kind is the destination and the repository is a scope over it, so
	// the chosen repository survives switching between them.
	const [selectedRepository, setSelectedRepository] = useState<string | null | undefined>(
		undefined,
	);
	const [kind, setKind] = useState<ItemKind>("pull_request");
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [dismissedFailure, setDismissedFailure] = useState<number | undefined>(undefined);
	const [question, setQuestion] = useState<AssessmentQuestion | undefined>(undefined);
	const config = useConfig();
	const catalogs = useAgentCatalogs();
	// Held here rather than in the settings screen: it applies whether or not that screen is open.
	const [appearance, chooseAppearance] = useAppearance();
	const [panelWidth, setPanelWidth] = usePanelWidth();

	// A refresh with a lot to assess asks before spending anything.
	useEffect(() => api.on("confirm-assessments", setQuestion), [api]);

	// First run: there is nothing to show until a repository is tracked, so open settings on it.
	useEffect(() => {
		if (repositories.value?.length === 0) {
			setSettingsOpen(true);
		}
	}, [repositories.value]);

	// Falls back to the first tracked repository, and follows a notification's "open this one".
	// `null` is a scope the user chose, so it is left alone; `undefined` is "nothing picked yet".
	useEffect(() => {
		// Nothing to fall back to until the list has arrived; running before it would take the
		// "nothing picked yet" state for a deliberate All and leave it there.
		if (repositories.value === undefined) {
			return;
		}
		const loaded = repositories.value;
		const first = loaded[0]?.name ?? null;
		setSelectedRepository((current) =>
			current === null || (current !== undefined && loaded.some((item) => item.name === current))
				? current
				: first,
		);
	}, [repositories.value]);

	const tracked = repositories.value ?? [];
	const anyIssues = tracked.some((entry) => entry.issues);
	// Nothing tracks issues, so the rail would offer a destination with nothing behind it.
	useEffect(() => {
		if (!anyIssues) {
			setKind("pull_request");
		}
	}, [anyIssues]);

	// The scope's due counts, which is what the rail's badges say.
	const inScope =
		selectedRepository === null
			? tracked
			: tracked.filter((entry) => entry.name === selectedRepository);
	const due = {
		pull_request: inScope.reduce((total, entry) => total + entry.due, 0),
		issue: inScope.reduce((total, entry) => total + entry.dueIssues, 0),
	};

	// ⌘1 and ⌘2 switch destination, which is the only navigation the window has.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (!event.metaKey || event.altKey || event.ctrlKey) {
				return;
			}
			if (event.key === "1") {
				event.preventDefault();
				setKind("pull_request");
			} else if (event.key === "2" && anyIssues) {
				event.preventDefault();
				setKind("issue");
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [anyIssues]);

	const jobs = useJobs();

	const current = repositories.value?.find((item) => item.name === selectedRepository);
	// A refresh, or a batch of assessments started from the header, is what the header reports on.
	const headerJob = jobs.find(
		(job) =>
			isActiveJob(job) &&
			job.repository === selectedRepository &&
			(job.kind === "refresh" || (job.kind === "assessment" && job.number === null)),
	);

	// A command that reports failure has nowhere better to go than the console for now.
	const run = useCallback((work: Promise<unknown>): void => {
		work.catch((cause: unknown) => console.error(cause));
	}, []);

	// At the All scope, refreshing means every tracked repository.
	const refreshScope = useCallback(() => {
		if (selectedRepository === null) {
			run(api.refreshAll());
		} else if (selectedRepository !== undefined) {
			run(api.refresh({ repository: selectedRepository }));
		}
	}, [api, run, selectedRepository]);

	const failure = current?.lastRefresh?.outcome === "failed" ? current.lastRefresh : undefined;

	// The review effort picker offers what the review profile's own agent and model accept.
	const review = config.value?.profiles.review;
	const reviewEffort = review?.effort;
	const reviewEfforts = effortsFor(
		review ? catalogs.value?.[review.agent] : undefined,
		review?.model,
	);

	return (
		<div className="app">
			{settingsOpen && config.value ? (
				<SettingsDialog
					config={config.value}
					appearance={appearance}
					onAppearanceChange={chooseAppearance}
					onClose={() => setSettingsOpen(false)}
					onSave={(next) => {
						run(
							(async (): Promise<void> => {
								await api.writeConfig(next);
								config.reload();
								repositories.reload();
							})(),
						);
					}}
				/>
			) : null}
			{question ? (
				<AssessmentDialog
					question={question}
					onAnswer={(numbers) => {
						setQuestion(undefined);
						run(api.answerAssessments({ requestId: question.requestId, numbers }));
					}}
				/>
			) : null}
			<Header
				repositories={repositories.value ?? []}
				selected={selectedRepository ?? null}
				onSelect={setSelectedRepository}
			>
				<RefreshControl
					repository={current}
					kind={kind}
					due={due[kind]}
					job={headerJob}
					showRefreshAll={(repositories.value?.length ?? 0) > 1}
					onRefresh={refreshScope}
					onRefreshAll={() => run(api.refreshAll())}
					onAssess={(full) => {
						for (const entry of inScope) {
							run(api.assessDue({ repository: entry.name, kind, full }));
						}
					}}
					onAbort={(id) => run(api.abort({ id }))}
				/>
				<JobsPanel
					jobs={jobs}
					showRepository={(repositories.value?.length ?? 0) > 1}
					onAbort={(id) => run(api.abort({ id }))}
				/>
				<Tool
					icon={GearSixIcon}
					label="Settings"
					emphasis="plain"
					disabled={false}
					onClick={() => setSettingsOpen(true)}
				/>
			</Header>

			{repositories.error !== undefined ? (
				<div className="placeholder error">{repositories.error}</div>
			) : repositories.loading ? (
				<div className="placeholder">
					<h2>Loading…</h2>
				</div>
			) : repositories.value?.length === 0 ? (
				<div className="placeholder">
					<h2>No repositories yet</h2>
					<p>Track one and its open pull requests show up here.</p>
					<div>
						<Button variant="primary" onClick={() => setSettingsOpen(true)}>
							Add a repository
						</Button>
					</div>
				</div>
			) : (
				<div className="app-columns">
					<Rail kind={kind} onSelect={setKind} due={due} showIssues={anyIssues} />
					<ItemsPage
						key={kind}
						kind={kind}
						repository={selectedRepository}
						current={current}
						jobs={jobs}
						failure={failure && failure.id !== dismissedFailure ? failure : undefined}
						onDismissFailure={(refresh) => setDismissedFailure(refresh.id)}
						onRefresh={refreshScope}
						panelWidth={panelWidth}
						onPanelWidthChange={setPanelWidth}
						reviewEfforts={reviewEfforts}
						reviewEffort={reviewEffort}
						reviewAgent={review?.agent}
					/>
				</div>
			)}
		</div>
	);
}
