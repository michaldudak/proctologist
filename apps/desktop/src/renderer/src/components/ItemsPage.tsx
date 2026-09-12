import { Button } from "@cloudflare/kumo";
import { useCallback, useMemo } from "react";
import { AGENT_LABELS, type EffortLevel, type ItemKind } from "@proctologist/core/browser";
import type { Job, Refresh, RepositorySummary } from "../../../shared/ipc.js";
import { useApi } from "../api.js";
import { isActiveJob } from "../lib/jobs.js";
import { parseItemKey } from "../state/ItemListStore.js";
import { useColumns } from "../state/useColumns.js";
import { useItemList } from "../state/useItemList.js";
import { FilterBar } from "./FilterBar.js";
import { ItemTable } from "./ItemTable.js";
import { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, PanelResizer } from "./PanelResizer.js";
import { RefreshFailure } from "./RefreshFailure.js";
import { SelectionBar } from "./SelectionBar.js";
import { SidePanel } from "./SidePanel.js";

export interface ItemsPageProps {
	/** Which destination this is. Everything below belongs to it and to no other. */
	kind: ItemKind;
	/** The scope: a repository, null for every one of them, undefined before one is picked. */
	repository: string | null | undefined;
	current: RepositorySummary | undefined;
	jobs: Job[];
	failure: Refresh | undefined;
	onDismissFailure: (refresh: Refresh) => void;
	/** Fetches the current scope, which the empty state and the failure banner both offer. */
	onRefresh: () => void;
	panelWidth: number;
	onPanelWidthChange: (width: number) => void;
	reviewEfforts: { effort: string; description: string }[];
	reviewEffort: string | undefined;
	reviewAgent: string | undefined;
}

/**
 * One destination: its filters, its columns, its sort, its cursor and its ticks, none of which the
 * other destination has any business seeing. Pull requests and issues look alike and are not the
 * same list — different columns, different facets, different words for the same judgment — so the
 * building blocks below are shared and the state is not.
 *
 * What is deliberately not here is the scope: which repository you are looking at follows you from
 * one destination to the other, because the workflow is "this repository, now its issues".
 */
export function ItemsPage({
	kind,
	repository,
	current,
	jobs,
	failure,
	onDismissFailure,
	onRefresh,
	panelWidth,
	onPanelWidthChange,
	reviewEfforts,
	reviewEffort,
	reviewAgent,
}: ItemsPageProps): React.JSX.Element {
	const api = useApi();
	const list = useItemList(repository, kind);
	const [columns, setColumns] = useColumns(kind);

	const rows = list.useState("rows");
	const visible = list.useState("visible");
	const filters = list.useState("filters");
	const sort = list.useState("sort");
	const selectedKey = list.useState("selected");
	const picked = list.useState("checkedVisible");
	const loading = list.useState("loading");
	// The panel and the actions need the identity behind the key, which carries the repository too
	// now that the scope can be every repository at once.
	const selectedRef = selectedKey === null ? null : parseItemKey(selectedKey);

	const rowJob = jobs.find(
		(job) =>
			isActiveJob(job) &&
			job.repository === selectedRef?.repository &&
			job.number === selectedRef.number,
	);

	// A command that reports failure has nowhere better to go than the console for now.
	const run = useCallback((work: Promise<unknown>): void => {
		work.catch((cause: unknown) => console.error(cause));
	}, []);

	/**
	 * Judges exactly the rows the checkboxes picked out — as one job per repository rather than one
	 * per item, so a run of them is a chunk the agent reads together rather than a queue of
	 * single-item runs waiting on each other.
	 */
	const judgeChecked = useCallback(() => {
		const byRepository = new Map<string, number[]>();
		for (const key of picked) {
			const ref = parseItemKey(key);
			const numbers = byRepository.get(ref.repository) ?? [];
			numbers.push(ref.number);
			byRepository.set(ref.repository, numbers);
		}
		// A job belongs to one repository, so the All scope means one job each, not one job over all.
		for (const [name, numbers] of byRepository) {
			run(api.assessItems({ repository: name, kind, numbers }));
		}
		list.clearVisibleChecked();
	}, [api, run, picked, kind, list]);

	const actions = useMemo(
		() => ({
			reassess: () => {
				if (selectedRef !== null) {
					run(api.assessQuick({ ...selectedRef }));
				}
			},
			assessThorough: () => {
				if (selectedRef !== null) {
					run(api.assessThorough({ ...selectedRef }));
				}
			},
			draftReview: (effort: EffortLevel | undefined) => {
				if (selectedRef !== null) {
					run(api.draftReview({ ...selectedRef, effort }));
				}
			},
			snooze: (until?: string) => {
				if (selectedRef !== null) {
					run(api.snooze({ ...selectedRef, until }));
				}
			},
			unsnooze: () => {
				if (selectedRef !== null) {
					run(api.unsnooze({ ...selectedRef }));
				}
			},
		}),
		[api, run, selectedRef],
	);

	return (
		<div className="app-main">
			<FilterBar
				rows={rows}
				kind={kind}
				allRepositories={repository === null}
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
			{picked.length > 0 ? (
				<SelectionBar
					count={picked.length}
					kind={kind}
					onJudge={judgeChecked}
					onSnooze={(untilDate) => {
						for (const key of picked) {
							run(api.snooze({ ...parseItemKey(key), until: untilDate }));
						}
						list.clearVisibleChecked();
					}}
					onClear={() => list.clearVisibleChecked()}
				/>
			) : null}
			{failure ? (
				<RefreshFailure
					refresh={failure}
					onRetry={() => {
						onDismissFailure(failure);
						onRefresh();
					}}
					onDismiss={() => onDismissFailure(failure)}
				/>
			) : null}
			<div
				className="app-body"
				data-panel={selectedRef === null ? "closed" : "open"}
				style={{ "--app-panel-width": `${String(panelWidth)}px` } as React.CSSProperties}
			>
				{visible.length === 0 ? (
					<EmptyTable
						loading={loading}
						kind={kind}
						onRefresh={onRefresh}
						filtered={rows.length > 0}
						failure={failure ? (failure.error ?? "The last refresh failed.") : undefined}
					/>
				) : (
					<ItemTable
						store={list}
						onOpen={(row) => void api.openOnGitHub({ url: row.item.url })}
						columns={columns}
						compact={selectedRef !== null}
						kind={kind}
						allRepositories={repository === null}
					/>
				)}
				{selectedRef === null ? null : (
					<>
						<PanelResizer
							width={panelWidth}
							onChange={onPanelWidthChange}
							min={MIN_PANEL_WIDTH}
							max={MAX_PANEL_WIDTH}
						/>
						<SidePanel
							store={list}
							job={rowJob}
							hasClone={current?.clone !== null && current?.clone !== undefined}
							efforts={reviewEfforts}
							defaultEffort={reviewEffort}
							agentLabel={reviewAgent ? AGENT_LABELS[reviewAgent as "codex" | "claude"] : "Agent"}
							actions={actions}
							onSetNote={(text) => {
								if (selectedRef !== null) {
									run(api.setNote({ ...selectedRef, text }));
								}
							}}
							onCopy={(text) => run(api.copyToClipboard({ text }))}
							onOpenOnGitHub={(url) => void api.openOnGitHub({ url })}
							onClose={() => list.setSelected(null)}
						/>
					</>
				)}
			</div>
		</div>
	);
}

interface EmptyTableProps {
	loading: boolean;
	kind: ItemKind;
	onRefresh: () => void;
	/** True when rows exist but the filter hides them, as opposed to there being none at all. */
	filtered: boolean;
	failure: string | undefined;
}

function EmptyTable({
	loading,
	kind,
	onRefresh,
	filtered,
	failure,
}: EmptyTableProps): React.JSX.Element {
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
				<Button size="sm" variant="secondary" onClick={onRefresh}>
					Try again
				</Button>
			</div>
		);
	}

	// The one thing to do from here is fetch, so it is a button rather than a sentence pointing at
	// a menu the user has no reason to have opened yet.
	return (
		<div className="placeholder">
			<h2>Nothing here yet</h2>
			<p>{`Fetch this repository's open ${kind === "issue" ? "issues" : "pull requests"}.`}</p>
			<Button size="sm" variant="primary" onClick={onRefresh}>
				Refresh
			</Button>
		</div>
	);
}
