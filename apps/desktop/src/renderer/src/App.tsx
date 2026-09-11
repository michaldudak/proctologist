import { Button } from "@cloudflare/kumo";
import { GearSixIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AGENT_LABELS, effortsFor, type EffortLevel } from "@proctologist/core/browser";
import type { AssessmentQuestion } from "../../shared/ipc.js";
import { useApi } from "./api.js";
import { FilterBar } from "./components/FilterBar.js";
import { Header } from "./components/Header.js";
import { JobsPanel } from "./components/JobsPanel.js";
import { ItemTable } from "./components/ItemTable.js";
import { SidePanel } from "./components/SidePanel.js";
import { isActiveJob } from "./lib/jobs.js";
import { AssessmentDialog } from "./components/AssessmentDialog.js";
import { PanelResizer, MAX_PANEL_WIDTH, MIN_PANEL_WIDTH } from "./components/PanelResizer.js";
import { RefreshControl } from "./components/RefreshControl.js";
import { RefreshFailure } from "./components/RefreshFailure.js";
import { SettingsDialog } from "./components/SettingsDialog.js";
import { Tool } from "./components/Tool.js";
import { useAppearance } from "./state/useAppearance.js";
import { useColumns } from "./state/useColumns.js";
import { usePanelWidth } from "./state/usePanelWidth.js";
import { useItemList } from "./state/useItemList.js";
import { useAgentCatalogs, useConfig, useJobs, useRepositories } from "./state/useData.js";

export function App(): React.JSX.Element {
	const api = useApi();
	const repositories = useRepositories();
	const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [dismissedFailure, setDismissedFailure] = useState<number | undefined>(undefined);
	const [question, setQuestion] = useState<AssessmentQuestion | undefined>(undefined);
	const config = useConfig();
	const catalogs = useAgentCatalogs();
	// Held here rather than in the settings screen: it applies whether or not that screen is open.
	const [appearance, chooseAppearance] = useAppearance();
	const [panelWidth, setPanelWidth] = usePanelWidth();
	const [columns, setColumns] = useColumns();

	// A refresh with a lot to assess asks before spending anything.
	useEffect(() => api.on("confirm-assessments", setQuestion), [api]);

	// First run: there is nothing to show until a repository is tracked, so open settings on it.
	useEffect(() => {
		if (repositories.value?.length === 0) {
			setSettingsOpen(true);
		}
	}, [repositories.value]);

	// Falls back to the first tracked repository, and follows a notification's "open this one".
	useEffect(() => {
		const first = repositories.value?.[0]?.name ?? null;
		setSelectedRepository((current) =>
			current !== null && repositories.value?.some((item) => item.name === current)
				? current
				: first,
		);
	}, [repositories.value]);

	const list = useItemList(selectedRepository);
	const rows = list.useState("rows");
	const visible = list.useState("visible");
	const filters = list.useState("filters");
	const sort = list.useState("sort");
	const selectedNumber = list.useState("selected");
	const loading = list.useState("loading");
	const jobs = useJobs();

	const current = repositories.value?.find((item) => item.name === selectedRepository);
	// A refresh, or a batch of assessments started from the header, is what the header reports on.
	const headerJob = jobs.find(
		(job) =>
			isActiveJob(job) &&
			job.repository === selectedRepository &&
			(job.kind === "refresh" || (job.kind === "assessment" && job.number === null)),
	);
	const rowJob = jobs.find(
		(job) =>
			isActiveJob(job) && job.repository === selectedRepository && job.number === selectedNumber,
	);

	// A command that reports failure has nowhere better to go than the console for now.
	const run = useCallback((work: Promise<unknown>): void => {
		work.catch((cause: unknown) => console.error(cause));
	}, []);

	const actions = useMemo(
		() => ({
			reassess: () => {
				if (selectedRepository !== null && selectedNumber !== null) {
					run(api.assessQuick({ repository: selectedRepository, number: selectedNumber }));
				}
			},
			assessThorough: () => {
				if (selectedRepository !== null && selectedNumber !== null) {
					run(api.assessThorough({ repository: selectedRepository, number: selectedNumber }));
				}
			},
			draftReview: (effort: EffortLevel | undefined) => {
				if (selectedRepository !== null && selectedNumber !== null) {
					run(api.draftReview({ repository: selectedRepository, number: selectedNumber, effort }));
				}
			},
			snooze: (until?: string) => {
				if (selectedRepository !== null && selectedNumber !== null) {
					run(api.snooze({ repository: selectedRepository, number: selectedNumber, until }));
				}
			},
			unsnooze: () => {
				if (selectedRepository !== null && selectedNumber !== null) {
					run(api.unsnooze({ repository: selectedRepository, number: selectedNumber }));
				}
			},
		}),
		[api, run, selectedRepository, selectedNumber],
	);

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
				selected={selectedRepository}
				onSelect={setSelectedRepository}
			>
				<RefreshControl
					repository={current}
					job={headerJob}
					showRefreshAll={(repositories.value?.length ?? 0) > 1}
					onRefresh={() => {
						if (selectedRepository !== null) {
							run(api.refresh({ repository: selectedRepository }));
						}
					}}
					onRefreshAll={() => run(api.refreshAll())}
					onAssess={(full) => {
						if (selectedRepository !== null) {
							run(api.assessDue({ repository: selectedRepository, full }));
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
				<>
					<FilterBar
						rows={rows}
						filters={filters}
						onChange={(next) => list.setFilters(next)}
						shown={visible.length}
						columns={columns}
						onColumnsChange={(next) => {
							setColumns(next);
							// An order the table can no longer show would be a puzzle, so it is let go.
							if (sort.key !== "default" && !next.includes(sort.key)) {
								list.resetSort();
							}
						}}
					/>
					{failure && failure.id !== dismissedFailure ? (
						<RefreshFailure
							refresh={failure}
							onRetry={() => {
								setDismissedFailure(failure.id);
								run(api.refresh({ repository: failure.repository }));
							}}
							onDismiss={() => setDismissedFailure(failure.id)}
						/>
					) : null}
					<div
						className="app-body"
						data-panel={selectedNumber === null ? "closed" : "open"}
						style={{ "--app-panel-width": `${String(panelWidth)}px` } as React.CSSProperties}
					>
						{visible.length === 0 ? (
							<EmptyTable
								loading={loading}
								filtered={rows.length > 0}
								failure={failure ? (failure.error ?? "The last refresh failed.") : undefined}
							/>
						) : (
							<ItemTable
								store={list}
								onOpen={(row) => void api.openOnGitHub({ url: row.item.url })}
								columns={columns}
								compact={selectedNumber !== null}
							/>
						)}
						{selectedNumber === null ? null : (
							<>
								<PanelResizer
									width={panelWidth}
									onChange={setPanelWidth}
									min={MIN_PANEL_WIDTH}
									max={MAX_PANEL_WIDTH}
								/>
								<SidePanel
									store={list}
									job={rowJob}
									hasClone={current?.clone !== null && current?.clone !== undefined}
									efforts={reviewEfforts}
									defaultEffort={reviewEffort}
									agentLabel={review ? AGENT_LABELS[review.agent] : "Agent"}
									actions={actions}
									onSetNote={(text) => {
										if (selectedRepository !== null && selectedNumber !== null) {
											run(
												api.setNote({
													repository: selectedRepository,
													number: selectedNumber,
													text,
												}),
											);
										}
									}}
									onCopy={(text) => run(api.copyToClipboard({ text }))}
									onOpenOnGitHub={(url) => void api.openOnGitHub({ url })}
									onClose={() => list.setSelected(null)}
								/>
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}

interface EmptyTableProps {
	loading: boolean;
	/** True when rows exist but the filter hides them, as opposed to there being none at all. */
	filtered: boolean;
	failure: string | undefined;
}

function EmptyTable({ loading, filtered, failure }: EmptyTableProps): React.JSX.Element {
	if (loading) {
		return (
			<div className="placeholder">
				<h2>Loading…</h2>
			</div>
		);
	}

	if (filtered) {
		return (
			<div className="placeholder">
				<h2>Nothing matches</h2>
				<p>Try clearing a filter.</p>
			</div>
		);
	}

	if (failure !== undefined) {
		return (
			<div className="placeholder">
				<h2>The last refresh failed</h2>
				<p className="error">{failure}</p>
			</div>
		);
	}

	return (
		<div className="placeholder">
			<h2>Nothing here yet</h2>
			<p>Press Refresh to fetch this repository's open pull requests.</p>
		</div>
	);
}
