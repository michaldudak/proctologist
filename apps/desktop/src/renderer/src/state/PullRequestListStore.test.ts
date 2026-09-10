import { describe, expect, it } from "vitest";
import type { PullRequestDetail } from "../../../shared/ipc.js";
import { row, verdict } from "../mock/rows.js";
import { EMPTY_FILTERS } from "../lib/filters.js";
import { PullRequestListStore, reconcileRows } from "./PullRequestListStore.js";

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

describe("PullRequestListStore", () => {
	it("leaves the visible sequence alone when a load changes only what a row says", () => {
		const store = new PullRequestListStore();
		store.replaceRows([row({ number: 1, assessing: "queued" }), row({ number: 2 })]);
		const numbers = store.select("visibleNumbers");
		const untouched = store.select("row", 2);

		store.replaceRows([row({ number: 1, assessing: "running" }), row({ number: 2 })]);

		expect(store.select("visibleNumbers")).toBe(numbers);
		expect(store.select("row", 2)).toBe(untouched);
		expect(store.select("row", 1)?.assessing).toBe("running");
		expect(store.state.loading).toBe(false);
	});

	it("reorders when an assessment moves a row", () => {
		const store = new PullRequestListStore();
		store.replaceRows([
			row({ number: 1, verdict: verdict({ nextAction: "wait" }) }),
			row({ number: 2, verdict: null }),
		]);
		expect(store.select("visibleNumbers")).toEqual([1, 2]);

		store.replaceRows([
			row({ number: 1, verdict: verdict({ nextAction: "wait" }) }),
			row({ number: 2, verdict: verdict({ nextAction: "merge" }) }),
		]);
		expect(store.select("visibleNumbers")).toEqual([2, 1]);
	});

	it("drops a selection that filtering hides", () => {
		const store = new PullRequestListStore();
		store.replaceRows([row({ number: 1, isDraft: true }), row({ number: 2 })]);
		store.setSelected(1);

		store.setFilters({ ...EMPTY_FILTERS, flags: ["notDraft"] });

		expect(store.state.selected).toBeNull();
	});

	it("drops a selection that a load no longer lists", () => {
		const store = new PullRequestListStore();
		store.replaceRows([row({ number: 1 }), row({ number: 2 })]);
		store.setSelected(2);

		store.replaceRows([row({ number: 1 })]);

		expect(store.state.selected).toBeNull();
	});

	it("puts the keyboard on the selected row, or the first while none is", () => {
		const store = new PullRequestListStore();
		store.replaceRows([row({ number: 1 }), row({ number: 2 })]);
		expect(store.select("isTabStop", 1)).toBe(true);
		expect(store.select("isTabStop", 2)).toBe(false);

		store.setSelected(2);
		expect(store.select("isTabStop", 1)).toBe(false);
		expect(store.select("isTabStop", 2)).toBe(true);
	});

	it("moves the selection along the visible rows and stops at the ends", () => {
		const store = new PullRequestListStore();
		store.replaceRows([row({ number: 1 }), row({ number: 2 })]);

		store.moveSelection(1);
		expect(store.state.selected).toBe(1);
		store.moveSelection(1);
		expect(store.state.selected).toBe(2);
		store.moveSelection(1);
		expect(store.state.selected).toBe(2);
		store.moveSelection(-5);
		expect(store.state.selected).toBe(1);
	});

	it("sorts on a column, then flips it, with dates newest first", () => {
		const store = new PullRequestListStore();
		store.toggleSort("title");
		expect(store.state.sort).toEqual({ key: "title", direction: "asc" });
		store.toggleSort("title");
		expect(store.state.sort).toEqual({ key: "title", direction: "desc" });
		store.toggleSort("age");
		expect(store.state.sort).toEqual({ key: "age", direction: "desc" });
	});
});

/** A detail as the bridge answers, with nothing beyond the row. */
function detail(number: number, note?: string): PullRequestDetail {
	return {
		...row({ number, note }),
		history: [],
		analysis: null,
		reviewDraft: null,
		reviewDraftMarkdown: null,
	};
}

describe("PullRequestListStore detail", () => {
	it("keeps the detail shown while a reload of the same pull request is on its way", () => {
		const store = new PullRequestListStore();
		store.startLoadingDetail(1);
		expect(store.state.detailLoading).toBe(true);
		const first = detail(1);
		store.replaceDetail(first);
		expect(store.state.detailLoading).toBe(false);

		store.startLoadingDetail(1);
		expect(store.state.detail).toBe(first);
		expect(store.state.detailLoading).toBe(true);
	});

	it("takes another pull request's detail down at once", () => {
		const store = new PullRequestListStore();
		store.replaceDetail(detail(1));
		store.startLoadingDetail(2);
		expect(store.state.detail).toBeUndefined();
		store.startLoadingDetail(null);
		expect(store.state.detailLoading).toBe(false);
	});

	it("keeps the detail's identity when the reload reads the same, and takes a changed one", () => {
		const store = new PullRequestListStore();
		const first = detail(1);
		store.replaceDetail(first);
		store.replaceDetail(structuredClone(first));
		expect(store.state.detail).toBe(first);

		const noted = detail(1, "Worth a look");
		store.replaceDetail(noted);
		expect(store.state.detail).toBe(noted);
	});

	it("clears an error once an answer arrives", () => {
		const store = new PullRequestListStore();
		store.failLoadingDetail("Gone");
		expect(store.state.detailError).toBe("Gone");
		store.replaceDetail(detail(1));
		expect(store.state.detailError).toBeUndefined();
	});
});
