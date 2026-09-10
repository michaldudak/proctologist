import { areArraysEqual } from "@base-ui/utils/areArraysEqual";
import {
	createSelector,
	createSelectorMemoized,
	createSelectorMemoizedWithOptions,
	ReactStore,
} from "@base-ui/utils/store";
import type { PullRequestRow } from "../../../shared/ipc.js";
import { isDeepEqual } from "../lib/equal.js";
import {
	applyFilters,
	EMPTY_FILTERS,
	sortRows,
	type Filters,
	type SortDirection,
	type SortKey,
} from "../lib/filters.js";

export interface Sort {
	key: SortKey;
	direction: SortDirection;
}

export const DEFAULT_SORT: Sort = { key: "default", direction: "asc" };

export interface PullRequestListState {
	/**
	 * Every row of the repository, in the order the main process lists them. A row keeps its
	 * identity from one load to the next for as long as nothing about it reads differently, so a
	 * view of one row can tell at a glance whether it has anything new to show.
	 */
	rows: PullRequestRow[];
	/** True until the first answer to the current query arrives. */
	loading: boolean;
	error: string | undefined;
	filters: Filters;
	sort: Sort;
	/** The pull request the side panel shows, by number. */
	selected: number | null;
}

type State = PullRequestListState;

const rows = createSelector((state: State) => state.rows);
const filters = createSelector((state: State) => state.filters);
const sort = createSelector((state: State) => state.sort);
const selected = createSelector((state: State) => state.selected);

/** The rows the table shows, filtered and sorted. Recomputed only when one of its inputs changes. */
const visible = createSelectorMemoized(rows, filters, sort, (all, current, order) =>
	sortRows(applyFilters(all, current), order.key, order.direction),
);

/**
 * The numbers of the visible rows, in order. Keeps its identity while the sequence stays the same,
 * so an update that changes what a row says, but not where it sits, leaves the table itself alone.
 */
const visibleNumbers = createSelectorMemoizedWithOptions({
	memoizeOptions: { resultEqualityCheck: areArraysEqual },
})(visible, (shown) => shown.map((row) => row.pullRequest.number));

const byNumber = createSelectorMemoized(
	rows,
	(all) => new Map(all.map((row) => [row.pullRequest.number, row])),
);

const selectors = {
	rows,
	loading: createSelector((state: State) => state.loading),
	error: createSelector((state: State) => state.error),
	filters,
	includeClosed: createSelector((state: State) => state.filters.includeClosed),
	sort,
	selected,
	visible,
	visibleNumbers,
	row: createSelector(byNumber, (map, number: number) => map.get(number)),
	isSelected: createSelector((state: State, number: number) => state.selected === number),
	/** The one row the keyboard lands on: the selected one, or the first while none is. */
	isTabStop: createSelector(selected, visibleNumbers, (current, numbers, number: number) =>
		current === null ? numbers[0] === number : current === number,
	),
};

/**
 * Keeps every row that reads the same as before, by identity, and takes the new object only where
 * something changed. Returns `previous` itself when nothing did.
 */
export function reconcileRows(
	previous: PullRequestRow[],
	next: PullRequestRow[],
): PullRequestRow[] {
	const before = new Map(previous.map((row) => [row.pullRequest.number, row]));
	let unchanged = previous.length === next.length;
	const reconciled = next.map((row, index) => {
		const old = before.get(row.pullRequest.number);
		const kept = old !== undefined && isDeepEqual(old, row) ? old : row;
		if (kept !== previous[index]) {
			unchanged = false;
		}
		return kept;
	});
	return unchanged ? previous : reconciled;
}

/**
 * The state of the main table: the rows, how they are filtered and sorted, and which is selected.
 * Rows and views of them subscribe to exactly the slice they show, so an assessment landing on one
 * pull request redraws that row and nothing else.
 */
export class PullRequestListStore extends ReactStore<
	State,
	Record<string, never>,
	typeof selectors
> {
	constructor(initial: Partial<State> = {}) {
		super(
			{
				rows: [],
				loading: true,
				error: undefined,
				filters: EMPTY_FILTERS,
				sort: DEFAULT_SORT,
				selected: null,
				...initial,
			},
			{},
			selectors,
		);
	}

	/** A new query is on its way; what is shown stays until the answer replaces it. */
	startLoading(): void {
		this.set("loading", true);
	}

	/** Takes what the main process listed. Rows that read the same as before keep their identity. */
	replaceRows(next: PullRequestRow[]): void {
		this.update({ rows: reconcileRows(this.state.rows, next), loading: false, error: undefined });
		this.dropHiddenSelection();
	}

	failLoading(error: string): void {
		this.update({ loading: false, error });
	}

	setFilters(next: Filters): void {
		this.set("filters", next);
		this.dropHiddenSelection();
	}

	/** Sorts on a column, or flips the direction when it is already the one sorted on. */
	toggleSort(key: SortKey): void {
		const previous = this.state.sort;
		this.set(
			"sort",
			previous.key === key
				? { key, direction: previous.direction === "asc" ? "desc" : "asc" }
				: { key, direction: key === "age" || key === "lastActivity" ? "desc" : "asc" },
		);
	}

	/** Back to the default order, for when the column being sorted on has gone. */
	resetSort(): void {
		this.set("sort", DEFAULT_SORT);
	}

	setSelected(number: number | null): void {
		this.set("selected", number);
	}

	/** Moves the selection along the visible rows, or to the first when nothing is selected. */
	moveSelection(delta: number): void {
		const numbers = this.select("visibleNumbers");
		if (numbers.length === 0) {
			return;
		}
		const index = numbers.indexOf(this.state.selected ?? -1);
		const next = index === -1 ? 0 : Math.min(Math.max(index + delta, 0), numbers.length - 1);
		this.setSelected(numbers[next] ?? null);
	}

	// A row that filtering has hidden should not stay selected behind the panel.
	private dropHiddenSelection(): void {
		const current = this.state.selected;
		if (current !== null && !this.select("visibleNumbers").includes(current)) {
			this.set("selected", null);
		}
	}
}
