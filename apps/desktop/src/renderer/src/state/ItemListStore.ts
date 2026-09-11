import { areArraysEqual } from "@base-ui/utils/areArraysEqual";
import {
	createSelector,
	createSelectorMemoized,
	createSelectorMemoizedWithOptions,
	ReactStore,
} from "@base-ui/utils/store";
import type { ItemKind } from "@proctologist/core/browser";
import type { ItemDetail, ItemRow } from "../../../shared/ipc.js";
import { isDeepEqual } from "../lib/equal.js";
import {
	applyFilters,
	EMPTY_FILTERS,
	sortRows,
	type Filters,
	type SortDirection,
	type SortKey,
} from "../lib/filters.js";

/**
 * What identifies a row here. A number alone was enough while one list held one kind of one
 * repository; it holds neither once the rail separates the kinds and the scope can be every
 * repository at once, where two repositories both have a #42.
 */
export type ItemKey = string;

export function itemKey(row: {
	item: { repository: string; kind: string; number: number };
}): ItemKey {
	return `${row.item.repository}#${row.item.kind}#${String(row.item.number)}`;
}

/** The identity back out of a key, for the commands that name an item over the wire. */
export function parseItemKey(key: ItemKey): { repository: string; kind: ItemKind; number: number } {
	const [repository = "", kind = "pull_request", number = "0"] = key.split("#");
	return { repository, kind: kind as ItemKind, number: Number(number) };
}

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
	rows: ItemRow[];
	/** True until the first answer to the current query arrives. */
	loading: boolean;
	error: string | undefined;
	filters: Filters;
	sort: Sort;
	/** The item the side panel shows. */
	selected: ItemKey | null;
	/**
	 * What the checkboxes have picked out, for the primary button to act on. Separate from
	 * `selected`, which is the cursor: one drives the panel, the other drives the work.
	 */
	checked: ReadonlySet<ItemKey>;
	/**
	 * Everything the side panel shows about the selected pull request. Cleared when the selection
	 * moves, and otherwise kept, by identity, for as long as a reload reads the same.
	 */
	detail: ItemDetail | undefined;
	/** True until the first answer about the selected pull request arrives. */
	detailLoading: boolean;
	detailError: string | undefined;
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
const visibleKeys = createSelectorMemoizedWithOptions({
	memoizeOptions: { resultEqualityCheck: areArraysEqual },
})(visible, (shown) => shown.map(itemKey));

const byKey = createSelectorMemoized(rows, (all) => new Map(all.map((row) => [itemKey(row), row])));

const checked = createSelector((state: State) => state.checked);

const selectors = {
	rows,
	loading: createSelector((state: State) => state.loading),
	error: createSelector((state: State) => state.error),
	filters,
	includeClosed: createSelector((state: State) => state.filters.includeClosed),
	sort,
	selected,
	detail: createSelector((state: State) => state.detail),
	detailLoading: createSelector((state: State) => state.detailLoading),
	detailError: createSelector((state: State) => state.detailError),
	visible,
	visibleKeys,
	checked,
	row: createSelector(byKey, (map, key: ItemKey) => map.get(key)),
	isSelected: createSelector((state: State, key: ItemKey) => state.selected === key),
	isChecked: createSelector(checked, (picked, key: ItemKey) => picked.has(key)),
	/** How many of the visible rows are ticked, which is what the header checkbox reads. */
	checkedVisible: createSelectorMemoized(visibleKeys, checked, (keys, picked) =>
		keys.filter((key) => picked.has(key)),
	),
	/** The one row the keyboard lands on: the selected one, or the first while none is. */
	isTabStop: createSelector(selected, visibleKeys, (current, keys, key: ItemKey) =>
		current === null ? keys[0] === key : current === key,
	),
};

/**
 * Keeps every row that reads the same as before, by identity, and takes the new object only where
 * something changed. Returns `previous` itself when nothing did.
 */
export function reconcileRows(previous: ItemRow[], next: ItemRow[]): ItemRow[] {
	const before = new Map(previous.map((row) => [itemKey(row), row]));
	let unchanged = previous.length === next.length;
	const reconciled = next.map((row, index) => {
		const old = before.get(itemKey(row));
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
export class ItemListStore extends ReactStore<State, Record<string, never>, typeof selectors> {
	constructor(initial: Partial<State> = {}) {
		super(
			{
				rows: [],
				loading: true,
				error: undefined,
				filters: EMPTY_FILTERS,
				sort: DEFAULT_SORT,
				selected: null,
				checked: new Set<ItemKey>(),
				detail: undefined,
				detailLoading: false,
				detailError: undefined,
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
	replaceRows(next: ItemRow[]): void {
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

	setSelected(key: ItemKey | null): void {
		this.set("selected", key);
	}

	/** Ticks or unticks one row. */
	toggleChecked(key: ItemKey): void {
		const next = new Set(this.state.checked);
		if (!next.delete(key)) {
			next.add(key);
		}
		this.set("checked", next);
	}

	/**
	 * Ticks every visible row, or unticks them. Visible means every row matching the filters, not
	 * the handful the table has drawn: the difference is the whole point of the header checkbox on a
	 * list of a thousand.
	 */
	setAllVisibleChecked(ticked: boolean): void {
		const keys = this.select("visibleKeys");
		const next = new Set(this.state.checked);
		for (const key of keys) {
			if (ticked) {
				next.add(key);
			} else {
				next.delete(key);
			}
		}
		this.set("checked", next);
	}

	/** Ticks everything between two rows, which is what a shift-click means. */
	checkRange(from: ItemKey, to: ItemKey): void {
		const keys = this.select("visibleKeys");
		const start = keys.indexOf(from);
		const end = keys.indexOf(to);
		if (start === -1 || end === -1) {
			return;
		}
		const next = new Set(this.state.checked);
		for (const key of keys.slice(Math.min(start, end), Math.max(start, end) + 1)) {
			next.add(key);
		}
		this.set("checked", next);
	}

	clearChecked(): void {
		if (this.state.checked.size > 0) {
			this.set("checked", new Set<ItemKey>());
		}
	}

	/**
	 * The detail of `number` is on its way. What is shown stays while it is about the same pull
	 * request, so a reload redraws nothing; another pull request's detail is taken down at once.
	 */
	startLoadingDetail(key: ItemKey | null): void {
		const shown = this.state.detail ? itemKey(this.state.detail) : undefined;
		this.update({
			detail: shown === key ? this.state.detail : undefined,
			detailLoading: key !== null,
			detailError: undefined,
		});
	}

	/** Takes the answer, unless it reads exactly as what is already shown. */
	replaceDetail(next: ItemDetail): void {
		const current = this.state.detail;
		this.update({
			detail: current !== undefined && isDeepEqual(current, next) ? current : next,
			detailLoading: false,
			detailError: undefined,
		});
	}

	failLoadingDetail(error: string): void {
		this.update({ detailLoading: false, detailError: error });
	}

	/** Moves the selection along the visible rows, or to the first when nothing is selected. */
	moveSelection(delta: number): void {
		const keys = this.select("visibleKeys");
		if (keys.length === 0) {
			return;
		}
		const index = keys.indexOf(this.state.selected ?? "");
		const next = index === -1 ? 0 : Math.min(Math.max(index + delta, 0), keys.length - 1);
		this.setSelected(keys[next] ?? null);
	}

	// A row that filtering has hidden should not stay selected behind the panel.
	private dropHiddenSelection(): void {
		const current = this.state.selected;
		if (current !== null && !this.select("visibleKeys").includes(current)) {
			this.set("selected", null);
		}
	}
}
