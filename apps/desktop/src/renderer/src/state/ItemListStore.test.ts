import { describe, expect, it } from "vitest";
import type { ItemDetail, ItemRow } from "../../../shared/ipc.js";
import { row, verdict } from "../mock/rows.js";
import { EMPTY_FILTERS } from "../lib/filters.js";
import { ItemListStore, itemKey, reconcileRows } from "./ItemListStore.js";

/** The key of a pull request of the mock repository, which is what the store now works in. */
const key = (number: number): string => itemKey(row({ number }));

/** The same mock row, as an issue, for the cases where the two kinds have to be told apart. */
const issue = (number: number): ItemRow => {
	const base = row({ number });
	return { ...base, item: { ...base.item, kind: "issue" } } as ItemRow;
};

/** What the bridge does to every reply: a fresh copy of the same data. */
const clone = <T>(value: T): T => structuredClone(value);

describe("reconcileRows", () => {
	it("keeps the rows that read the same, and takes the ones that changed", () => {
		const first = row({ number: 1 });
		const second = row({ number: 2 });
		const next = [clone(first), row({ number: 2, title: "Renamed" })];

		const result = reconcileRows([first, second], next);

		expect(result[0]).toBe(first);
		expect(result[1]).toBe(next[1]);
	});

	it("returns the previous list itself when nothing changed", () => {
		const previous = [row({ number: 1 }), row({ number: 2 })];
		expect(reconcileRows(previous, clone(previous))).toBe(previous);
	});

	it("returns a new list when a row is added, removed or moved", () => {
		const first = row({ number: 1 });
		const second = row({ number: 2 });
		expect(reconcileRows([first, second], [clone(first)])).toEqual([first]);
		expect(reconcileRows([first], [clone(first), second])).toEqual([first, second]);
		expect(reconcileRows([first, second], [clone(second), clone(first)])).toEqual([second, first]);
	});
});

describe("ItemListStore", () => {
	it("keeps two repositories' #42 apart", () => {
		const store = new ItemListStore();
		const mine = row({ number: 42 });
		const theirs = {
			...row({ number: 42 }),
			item: { ...row({ number: 42 }).item, repository: "other/thing" },
		};
		store.replaceRows([mine, theirs]);

		expect(store.select("visibleKeys")).toHaveLength(2);
		expect(store.select("row", itemKey(theirs))?.item.repository).toBe("other/thing");
	});

	it("ticks every row matching the filters, not the ones drawn", () => {
		const store = new ItemListStore();
		store.replaceRows([row({ number: 1 }), row({ number: 2 }), row({ number: 3 })]);

		store.setAllVisibleChecked(true);

		// The table draws a window; the header checkbox means the filtered set behind it.
		expect(store.state.checked.size).toBe(3);
		store.setAllVisibleChecked(false);
		expect(store.state.checked.size).toBe(0);
	});

	it("leaves rows the filter hides out of a select-all", () => {
		const store = new ItemListStore();
		store.replaceRows([row({ number: 1, title: "keep" }), row({ number: 2, title: "drop" })]);
		store.setFilters({ ...EMPTY_FILTERS, search: "keep" });

		store.setAllVisibleChecked(true);

		expect([...store.state.checked]).toEqual([key(1)]);
	});

	it("ticks a range across rows that were never drawn", () => {
		const store = new ItemListStore();
		store.replaceRows([row({ number: 1 }), row({ number: 2 }), row({ number: 3 })]);

		store.checkRange(key(1), key(3));

		expect(store.state.checked.size).toBe(3);
	});

	it("does not carry a tick from one destination into another", () => {
		// Keys name the repository and the kind, so a pull request ticked here is still in the set
		// when the issue list replaces it — and must count for nothing there.
		const store = new ItemListStore();
		store.replaceRows([row({ number: 1 }), row({ number: 2 }), row({ number: 3 })]);
		store.setAllVisibleChecked(true);
		expect(store.select("checkedVisible")).toHaveLength(3);

		store.replaceRows([issue(900), issue(901)]);

		expect(store.select("checkedVisible")).toEqual([]);
		// Still held, so going back finds them where they were left.
		expect(store.state.checked.size).toBe(3);
	});

	it("unticks only the list on show", () => {
		const store = new ItemListStore();
		store.replaceRows([row({ number: 1 })]);
		store.setAllVisibleChecked(true);
		store.replaceRows([issue(900)]);
		store.toggleChecked(itemKey(issue(900)));

		store.clearVisibleChecked();

		expect(store.select("checkedVisible")).toEqual([]);
		// The pull request ticked in the other destination is not the user's to lose from here.
		expect(store.state.checked.size).toBe(1);
	});

	it("toggles one row on and off", () => {
		const store = new ItemListStore();
		store.replaceRows([row({ number: 1 })]);

		store.toggleChecked(key(1));
		expect(store.select("isChecked", key(1))).toBe(true);
		store.toggleChecked(key(1));
		expect(store.select("isChecked", key(1))).toBe(false);
	});

	it("leaves the visible sequence alone when a load changes only what a row says", () => {
		const store = new ItemListStore();
		store.replaceRows([
			row({ number: 1, activity: { job: "assessment", state: "queued" } }),
			row({ number: 2 }),
		]);
		const numbers = store.select("visibleKeys");
		const untouched = store.select("row", key(2));

		store.replaceRows([
			row({ number: 1, activity: { job: "assessment", state: "running" } }),
			row({ number: 2 }),
		]);

		expect(store.select("visibleKeys")).toBe(numbers);
		expect(store.select("row", key(2))).toBe(untouched);
		expect(store.select("row", key(1))?.activity?.state).toBe("running");
		expect(store.state.loading).toBe(false);
	});

	it("reorders when an assessment moves a row", () => {
		const store = new ItemListStore();
		store.replaceRows([
			row({ number: 1, verdict: verdict({ nextAction: "wait" }) }),
			row({ number: 2, verdict: null }),
		]);
		expect(store.select("visibleKeys")).toEqual([key(1), key(2)]);

		store.replaceRows([
			row({ number: 1, verdict: verdict({ nextAction: "wait" }) }),
			row({ number: 2, verdict: verdict({ nextAction: "merge" }) }),
		]);
		expect(store.select("visibleKeys")).toEqual([key(2), key(1)]);
	});

	it("drops a selection that filtering hides", () => {
		const store = new ItemListStore();
		store.replaceRows([row({ number: 1, isDraft: true }), row({ number: 2 })]);
		store.setSelected(key(1));

		store.setFilters({ ...EMPTY_FILTERS, flags: ["notDraft"] });

		expect(store.state.selected).toBeNull();
	});

	it("drops a selection that a load no longer lists", () => {
		const store = new ItemListStore();
		store.replaceRows([row({ number: 1 }), row({ number: 2 })]);
		store.setSelected(key(2));

		store.replaceRows([row({ number: 1 })]);

		expect(store.state.selected).toBeNull();
	});

	it("puts the keyboard on the selected row, or the first while none is", () => {
		const store = new ItemListStore();
		store.replaceRows([row({ number: 1 }), row({ number: 2 })]);
		expect(store.select("isTabStop", key(1))).toBe(true);
		expect(store.select("isTabStop", key(2))).toBe(false);

		store.setSelected(key(2));
		expect(store.select("isTabStop", key(1))).toBe(false);
		expect(store.select("isTabStop", key(2))).toBe(true);
	});

	it("moves the selection along the visible rows and stops at the ends", () => {
		const store = new ItemListStore();
		store.replaceRows([row({ number: 1 }), row({ number: 2 })]);

		store.moveSelection(1);
		expect(store.state.selected).toBe(key(1));
		store.moveSelection(1);
		expect(store.state.selected).toBe(key(2));
		store.moveSelection(1);
		expect(store.state.selected).toBe(key(2));
		store.moveSelection(-5);
		expect(store.state.selected).toBe(key(1));
	});

	it("sorts on a column, then flips it, with dates newest first", () => {
		const store = new ItemListStore();
		store.toggleSort("title");
		expect(store.state.sort).toEqual({ key: "title", direction: "asc" });
		store.toggleSort("title");
		expect(store.state.sort).toEqual({ key: "title", direction: "desc" });
		store.toggleSort("age");
		expect(store.state.sort).toEqual({ key: "age", direction: "desc" });
	});
});

/** A detail as the bridge answers, with nothing beyond the row. */
function detail(number: number, note?: string): ItemDetail {
	return {
		...row({ number, note }),
		history: [],
		analysis: null,
		reviewDraft: null,
		reviewDraftMarkdown: null,
	};
}

describe("ItemListStore detail", () => {
	it("keeps the detail shown while a reload of the same pull request is on its way", () => {
		const store = new ItemListStore();
		store.startLoadingDetail(key(1));
		expect(store.state.detailLoading).toBe(true);
		const first = detail(1);
		store.replaceDetail(first);
		expect(store.state.detailLoading).toBe(false);

		store.startLoadingDetail(key(1));
		expect(store.state.detail).toBe(first);
		expect(store.state.detailLoading).toBe(true);
	});

	it("takes another pull request's detail down at once", () => {
		const store = new ItemListStore();
		store.replaceDetail(detail(1));
		store.startLoadingDetail(key(2));
		expect(store.state.detail).toBeUndefined();
		store.startLoadingDetail(null);
		expect(store.state.detailLoading).toBe(false);
	});

	it("keeps the detail's identity when the reload reads the same, and takes a changed one", () => {
		const store = new ItemListStore();
		const first = detail(1);
		store.replaceDetail(first);
		store.replaceDetail(structuredClone(first));
		expect(store.state.detail).toBe(first);

		const noted = detail(1, "Worth a look");
		store.replaceDetail(noted);
		expect(store.state.detail).toBe(noted);
	});

	it("clears an error once an answer arrives", () => {
		const store = new ItemListStore();
		store.failLoadingDetail("Gone");
		expect(store.state.detailError).toBe("Gone");
		store.replaceDetail(detail(1));
		expect(store.state.detailError).toBeUndefined();
	});
});
