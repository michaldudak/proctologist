import { useEffect, useMemo, useState } from "react";
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
import { usePullRequestDetail, usePullRequests, useRepositories } from "./state/useData.js";

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

	// Falls back to the first tracked repository, and follows the menu bar's "open this one".
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

	const onSort = (key: SortKey): void => {
		setSort((current) =>
			current.key === key
				? { key, direction: current.direction === "asc" ? "desc" : "asc" }
				: { key, direction: key === "age" || key === "lastActivity" ? "desc" : "asc" },
		);
	};

	return (
		<div className="app">
			<Header
				repositories={repositories.value ?? []}
				selected={selectedRepository}
				onSelect={setSelectedRepository}
			/>

			{repositories.error !== undefined ? (
				<div className="placeholder error">{repositories.error}</div>
			) : (repositories.value?.length ?? 0) === 0 ? (
				<EmptyState loading={repositories.loading} />
			) : (
				<>
					<FilterBar rows={rows} filters={filters} onChange={setFilters} shown={visible.length} />
					<div className="app-body" data-panel={selectedNumber === null ? "closed" : "open"}>
						{visible.length === 0 ? (
							<div className="placeholder">
								<h2>{pullRequests.loading ? "Loading…" : "Nothing matches"}</h2>
								{pullRequests.loading ? null : (
									<p>
										{rows.length === 0
											? "This repository has not been refreshed yet."
											: "Try clearing a filter."}
									</p>
								)}
							</div>
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

function EmptyState({ loading }: { loading: boolean }): React.JSX.Element {
	return (
		<div className="placeholder">
			<h2>{loading ? "Loading…" : "No repositories tracked yet"}</h2>
			{loading ? null : <p>Add one to your config file to get started.</p>}
		</div>
	);
}
