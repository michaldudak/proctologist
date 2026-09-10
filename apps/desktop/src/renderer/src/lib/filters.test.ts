import { describe, expect, it } from "vitest";
import { row, verdict } from "../mock/rows.js";
import {
	applyFilters,
	EMPTY_FILTERS,
	facetCounts,
	flagCounts,
	isFiltered,
	sortRows,
	toggleFacet,
	toggleFlag,
	type Filters,
} from "./filters.js";

const rows = [
	row({ number: 1, verdict: verdict({ nextAction: "merge", effort: "XS" }) }),
	row({ number: 2, verdict: verdict({ nextAction: "review", effort: "S" }) }),
	row({
		number: 3,
		title: "Bump a dependency",
		isBot: true,
		author: "renovate",
		verdict: verdict({ nextAction: "merge", effort: "M", category: "dependency_infra" }),
	}),
	row({
		number: 4,
		authoredByUser: true,
		verdict: verdict({ nextAction: "continue", effort: "L" }),
	}),
	row({ number: 5, error: "The agent timed out" }),
	row({ number: 6, snoozedUntil: "2026-12-01T00:00:00.000Z", verdict: verdict() }),
	row({ number: 7, closedAt: "2026-09-05T12:00:00.000Z", verdict: verdict() }),
];

function numbers(filters: Partial<Filters>): number[] {
	return applyFilters(rows, { ...EMPTY_FILTERS, ...filters }).map(
		(item) => item.pullRequest.number,
	);
}

describe("applyFilters", () => {
	it("hides snoozed and closed pull requests by default", () => {
		expect(numbers({})).toEqual([1, 2, 3, 4, 5]);
	});

	it("shows snoozed and closed ones when asked", () => {
		expect(numbers({ includeSnoozed: true })).toContain(6);
		expect(numbers({ includeClosed: true })).toContain(7);
	});

	it("filters on a facet, with several values read as 'or'", () => {
		expect(numbers({ facets: { ...EMPTY_FILTERS.facets, nextAction: ["merge"] } })).toEqual([1, 3]);
		expect(
			numbers({ facets: { ...EMPTY_FILTERS.facets, nextAction: ["merge", "continue"] } }),
		).toEqual([1, 3, 4]);
	});

	it("reads several facets as 'and'", () => {
		expect(
			numbers({
				facets: { ...EMPTY_FILTERS.facets, nextAction: ["merge"], effort: ["XS"] },
			}),
		).toEqual([1]);
	});

	it("leaves out unassessed pull requests when a facet is chosen", () => {
		expect(numbers({ facets: { ...EMPTY_FILTERS.facets, effort: ["XS"] } })).not.toContain(5);
	});

	it("filters on flags, read as 'and'", () => {
		expect(numbers({ flags: ["bot"] })).toEqual([3]);
		expect(numbers({ flags: ["quickWin"] })).toEqual([1, 2]);
		expect(numbers({ flags: ["mine"] })).toEqual([4]);
		expect(numbers({ flags: ["unassessed"] })).toEqual([5]);
		expect(numbers({ flags: ["quickWin", "bot"] })).toEqual([]);
	});

	it("searches the number, title, author, labels, summary and note", () => {
		expect(numbers({ search: "dependency" })).toEqual([3]);
		expect(numbers({ search: "renovate" })).toEqual([3]);
		expect(numbers({ search: "4" })).toEqual([4]);
		expect(numbers({ search: "off-by-one" })).toEqual([1, 2, 3, 4]);
		expect(numbers({ search: "  " })).toEqual([1, 2, 3, 4, 5]);
	});

	it("finds a note the user wrote", () => {
		const withNote = [row({ number: 8, note: "Ask about the API shape", verdict: verdict() })];

		expect(applyFilters(withNote, { ...EMPTY_FILTERS, search: "api shape" })).toHaveLength(1);
	});
});

describe("facetCounts", () => {
	it("counts what each value would leave", () => {
		const counts = facetCounts(rows, EMPTY_FILTERS, "nextAction");

		expect(counts.get("merge")).toBe(2);
		expect(counts.get("review")).toBe(1);
		expect(counts.get("close")).toBeUndefined();
	});

	it("ignores the facet's own selection so its other options stay clickable", () => {
		const filters = {
			...EMPTY_FILTERS,
			facets: { ...EMPTY_FILTERS.facets, nextAction: ["merge"] },
		};
		const counts = facetCounts(rows, filters, "nextAction");

		expect(counts.get("merge")).toBe(2);
		expect(counts.get("review")).toBe(1);
	});

	it("applies the other facets and the search", () => {
		const filters = { ...EMPTY_FILTERS, flags: ["bot" as const] };

		expect(facetCounts(rows, filters, "nextAction").get("merge")).toBe(1);
	});
});

describe("flagCounts", () => {
	it("counts each flag against the rest of the filter", () => {
		const counts = flagCounts(rows, EMPTY_FILTERS);

		expect(counts.get("quickWin")).toBe(2);
		expect(counts.get("bot")).toBe(1);
		expect(counts.get("unassessed")).toBe(1);
		expect(counts.get("note")).toBe(0);
	});

	it("counts a selected flag as if it were not selected, so it can be switched off again", () => {
		expect(flagCounts(rows, { ...EMPTY_FILTERS, flags: ["bot"] }).get("bot")).toBe(1);
	});

	it("counts an unselected flag on top of the current filter, so zero means a dead end", () => {
		expect(flagCounts(rows, { ...EMPTY_FILTERS, flags: ["bot"] }).get("quickWin")).toBe(0);
	});
});

describe("toggles", () => {
	it("adds and removes a facet value", () => {
		const once = toggleFacet(EMPTY_FILTERS, "nextAction", "merge");
		expect(once.facets.nextAction).toEqual(["merge"]);
		expect(toggleFacet(once, "nextAction", "merge").facets.nextAction).toEqual([]);
	});

	it("adds and removes a flag", () => {
		const once = toggleFlag(EMPTY_FILTERS, "bot");
		expect(once.flags).toEqual(["bot"]);
		expect(toggleFlag(once, "bot").flags).toEqual([]);
	});

	it("knows when anything is filtered", () => {
		expect(isFiltered(EMPTY_FILTERS)).toBe(false);
		expect(isFiltered({ ...EMPTY_FILTERS, search: "x" })).toBe(true);
		expect(isFiltered({ ...EMPTY_FILTERS, search: "  " })).toBe(false);
		expect(isFiltered(toggleFlag(EMPTY_FILTERS, "bot"))).toBe(true);
		expect(isFiltered(toggleFacet(EMPTY_FILTERS, "effort", "XS"))).toBe(true);
	});
});

describe("sortRows", () => {
	it("puts merges first, then reviews, and unassessed last", () => {
		const sorted = sortRows(rows.slice(0, 5), "default", "asc");

		expect(sorted.map((item) => item.pullRequest.number)).toEqual([1, 3, 2, 4, 5]);
	});

	it("puts a quick win above a slower pull request needing the same action", () => {
		const sorted = sortRows(
			[
				row({ number: 1, verdict: verdict({ nextAction: "merge", effort: "XL" }) }),
				row({ number: 2, verdict: verdict({ nextAction: "merge", effort: "XS" }) }),
			],
			"default",
			"asc",
		);

		expect(sorted.map((item) => item.pullRequest.number)).toEqual([2, 1]);
	});

	it("sorts by a column in both directions", () => {
		expect(sortRows(rows, "number", "asc").map((item) => item.pullRequest.number)).toEqual([
			1, 2, 3, 4, 5, 6, 7,
		]);
		expect(sortRows(rows, "number", "desc")[0]?.pullRequest.number).toBe(7);
	});

	it("sorts effort by size rather than alphabetically", () => {
		const sorted = sortRows(rows.slice(0, 4), "effort", "asc");

		expect(sorted.map((item) => item.assessment?.verdict?.effort)).toEqual(["XS", "S", "M", "L"]);
	});

	it("leaves the original array alone", () => {
		const original = [...rows];
		sortRows(rows, "number", "desc");

		expect(rows).toEqual(original);
	});
});
