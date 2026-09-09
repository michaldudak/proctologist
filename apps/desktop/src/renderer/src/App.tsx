import { Button } from "@cloudflare/kumo";
import { useCallback, useEffect, useMemo, useState } from "react";
import { effortsFor, type ReasoningEffort } from "@proctologist/core/browser";
import type { AssessmentQuestion } from "../../shared/ipc.js";
import { useApi } from "./api.js";
import { FilterBar } from "./components/FilterBar.js";
import { Header } from "./components/Header.js";
import { PullRequestTable } from "./components/PullRequestTable.js";
import { SidePanel } from "./components/SidePanel.js";
import {
	applyFilters,
	EMPTY_FILTERS,
	sortRows,
	type Filters,
	type SortDirection,
	type SortKey,
} from "./lib/filters.js";
import { AssessmentDialog } from "./components/AssessmentDialog.js";
import { RefreshControl } from "./components/RefreshControl.js";
import { RefreshFailure } from "./components/RefreshFailure.js";
import { SettingsView } from "./components/SettingsView.js";
import {
	useCodexModels,
	useConfig,
	useJobs,
	usePullRequestDetail,
	usePullRequests,
	useRepositories,
} from "./state/useData.js";

export function App(): React.JSX.Element {
	const api = useApi();
	const repositories = useRepositories();
	const [selectedRepository, setSelectedRepository] = useState<string | null>(null);
	const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
	const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
		key: "default",
		direction: "asc",
	});
	const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [dismissedFailure, setDismissedFailure] = useState<number | undefined>(undefined);
	const [question, setQuestion] = useState<AssessmentQuestion | undefined>(undefined);
	const config = useConfig();
	const catalog = useCodexModels();

	// A refresh with a lot to assess asks before spending anything.
	useEffect(() => api.on("confirm-assessments", setQuestion), [api]);

	// Falls back to the first tracked repository, and follows a notification's "open this one".
	useEffect(() => {
		const first = repositories.value?.[0]?.name ?? null;
		setSelectedRepository((current) =>
			current !== null && repositories.value?.some((item) => item.name === current)
				? current
				: first,
		);
	}, [repositories.value]);

	const pullRequests = usePullRequests(selectedRepository, filters.includeClosed);
	const detail = usePullRequestDetail(selectedRepository, selectedNumber);
	const jobs = useJobs();
	const [busy, setBusy] = useState(false);

	const current = repositories.value?.find((item) => item.name === selectedRepository);
	const refreshJob = jobs.find(
		(job) => job.kind === "refresh" && job.repository === selectedRepository,
	);
	const rowJob = jobs.find(
		(job) => job.repository === selectedRepository && job.number === selectedNumber,
	);

	// A command that reports failure has nowhere better to go than the console for now.
	const run = useCallback((work: Promise<unknown>): void => {
		work.catch((cause: unknown) => console.error(cause));
	}, []);

	const rows = pullRequests.value ?? [];
	const visible = useMemo(
		() => sortRows(applyFilters(rows, filters), sort.key, sort.direction),
		[rows, filters, sort],
	);

	// A row that filtering has hidden should not stay selected behind the panel.
	useEffect(() => {
		if (
			selectedNumber !== null &&
			!visible.some((row) => row.pullRequest.number === selectedNumber)
		) {
			setSelectedNumber(null);
		}
	}, [visible, selectedNumber]);

	const actions = useMemo(
		() => ({
			reassess: () => {
				if (selectedRepository === null || selectedNumber === null) {
					return;
				}
				setBusy(true);
				void api
					.assessQuick({ repository: selectedRepository, number: selectedNumber })
					.catch((cause: unknown) => console.error(cause))
					.finally(() => setBusy(false));
			},
			assessThorough: () => {
				if (selectedRepository !== null && selectedNumber !== null) {
					run(api.assessThorough({ repository: selectedRepository, number: selectedNumber }));
				}
			},
			draftReview: (effort: ReasoningEffort) => {
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

	// The review effort picker offers what the review profile's model actually accepts.
	const reviewEffort = config.value?.codexProfiles.review.reasoningEffort ?? "high";
	const reviewEfforts = effortsFor(
		catalog.value?.models ?? [],
		config.value?.codexProfiles.review.model,
	);

	const onSort = (key: SortKey): void => {
		setSort((previous) =>
			previous.key === key
				? { key, direction: previous.direction === "asc" ? "desc" : "asc" }
				: { key, direction: key === "age" || key === "lastActivity" ? "desc" : "asc" },
		);
	};

	if (settingsOpen || (repositories.value?.length === 0 && !repositories.loading)) {
		return (
			<div className="app">
				<Header
					repositories={repositories.value ?? []}
					selected={selectedRepository}
					onSelect={setSelectedRepository}
				/>
				{config.value ? (
					<SettingsView
						config={config.value}
						onClose={() => setSettingsOpen(false)}
						onSave={(next) => {
							run(
								(async (): Promise<void> => {
									await api.writeConfig(next);
									setSettingsOpen(false);
									config.reload();
									repositories.reload();
								})(),
							);
						}}
					/>
				) : (
					<div className="placeholder">
						<h2>{config.error ?? "Loading…"}</h2>
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="app">
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
					job={refreshJob}
					showRefreshAll={(repositories.value?.length ?? 0) > 1}
					onRefresh={(full) => {
						if (selectedRepository !== null) {
							run(api.refresh({ repository: selectedRepository, full }));
						}
					}}
					onRefreshAll={() => run(api.refreshAll())}
					onAbort={(id) => run(api.abort({ id }))}
				/>
				<Button size="xs" variant="ghost" onClick={() => setSettingsOpen(true)}>
					Settings
				</Button>
			</Header>

			{repositories.error !== undefined ? (
				<div className="placeholder error">{repositories.error}</div>
			) : repositories.loading ? (
				<div className="placeholder">
					<h2>Loading…</h2>
				</div>
			) : (
				<>
					<FilterBar rows={rows} filters={filters} onChange={setFilters} shown={visible.length} />
					{failure && failure.id !== dismissedFailure ? (
						<RefreshFailure
							refresh={failure}
							onRetry={() => {
								setDismissedFailure(failure.id);
								run(api.refresh({ repository: failure.repository, full: false }));
							}}
							onDismiss={() => setDismissedFailure(failure.id)}
						/>
					) : null}
					<div className="app-body" data-panel={selectedNumber === null ? "closed" : "open"}>
						{visible.length === 0 ? (
							<EmptyTable
								loading={pullRequests.loading}
								filtered={rows.length > 0}
								failure={failure ? (failure.error ?? "The last refresh failed.") : undefined}
							/>
						) : (
							<PullRequestTable
								rows={visible}
								selected={selectedNumber}
								onSelect={setSelectedNumber}
								onOpen={(row) => void api.openOnGitHub({ url: row.pullRequest.url })}
								sort={sort}
								onSort={onSort}
								compact={selectedNumber !== null}
							/>
						)}
						{selectedNumber === null ? null : (
							<SidePanel
								detail={detail.value}
								loading={detail.loading}
								error={detail.error}
								job={rowJob}
								busy={busy}
								hasClone={current?.clone !== null && current?.clone !== undefined}
								efforts={reviewEfforts}
								defaultEffort={reviewEffort}
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
								onClose={() => setSelectedNumber(null)}
							/>
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
