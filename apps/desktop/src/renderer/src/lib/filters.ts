import type { NextAction } from "@proctologist/core/browser";
import { nextActionRank } from "@proctologist/core/browser";
import type { PullRequestRow } from "../../../shared/ipc.js";

/** Facets the filter bar filters on. Each is a set of values the assessment can hold. */
export const FACETS = ["nextAction", "area", "relevance", "status", "effort"] as const;
export type Facet = (typeof FACETS)[number];

/** Yes-or-no properties of a row, as opposed to a facet's several values. */
export const FLAGS = [
	"quickWin",
	"unassessed",
	"changed",
	"reviewRequested",
	"mine",
	"draft",
	"notDraft",
	"bot",
	"note",
] as const;
export type Flag = (typeof FLAGS)[number];

export interface Filters {
	search: string;
	facets: Record<Facet, string[]>;
	flags: Flag[];
	/** Snoozed and closed pull requests are out of the way unless explicitly asked for. */
	includeSnoozed: boolean;
	includeClosed: boolean;
}

export const EMPTY_FILTERS: Filters = {
	search: "",
	facets: { nextAction: [], area: [], relevance: [], status: [], effort: [] },
	flags: [],
	includeSnoozed: false,
	includeClosed: false,
};

export function isFiltered(filters: Filters): boolean {
	return (
		filters.search.trim() !== "" ||
		filters.flags.length > 0 ||
		filters.includeSnoozed ||
		filters.includeClosed ||
		FACETS.some((facet) => filters.facets[facet].length > 0)
	);
}

export function toggleFacet(filters: Filters, facet: Facet, value: string): Filters {
	const current = filters.facets[facet];
	const next = current.includes(value)
		? current.filter((item) => item !== value)
		: [...current, value];
	return { ...filters, facets: { ...filters.facets, [facet]: next } };
}

export function toggleFlag(filters: Filters, flag: Flag): Filters {
	return {
		...filters,
		flags: filters.flags.includes(flag)
			? filters.flags.filter((item) => item !== flag)
			: [...filters.flags, flag],
	};
}

function facetValue(row: PullRequestRow, facet: Facet): string | undefined {
	const verdict = row.assessment?.verdict;
	if (!verdict) {
		return undefined;
	}
	switch (facet) {
		case "nextAction": {
			return verdict.nextAction;
		}
		case "area": {
			return verdict.area;
		}
		case "relevance": {
			return verdict.relevance;
		}
		case "status": {
			return verdict.status;
		}
		default: {
			return verdict.effort;
		}
	}
}

export function hasFlag(row: PullRequestRow, flag: Flag): boolean {
	switch (flag) {
		case "quickWin": {
			return row.derived.quickWin;
		}
		case "unassessed": {
			return row.derived.unassessed;
		}
		case "changed": {
			return row.derived.changed.length > 0;
		}
		case "reviewRequested": {
			return row.pullRequest.reviewRequestedFromUser;
		}
		case "mine": {
			return row.pullRequest.authoredByUser;
		}
		case "draft": {
			return row.pullRequest.isDraft;
		}
		case "notDraft": {
			return !row.pullRequest.isDraft;
		}
		case "bot": {
			return row.pullRequest.isBot;
		}
		default: {
			return row.note !== null;
		}
	}
}

function matchesSearch(row: PullRequestRow, search: string): boolean {
	const term = search.trim().toLowerCase();
	if (term === "") {
		return true;
	}
	const haystack = [
		String(row.pullRequest.number),
		row.pullRequest.title,
		row.pullRequest.author,
		...row.pullRequest.labels,
		row.assessment?.verdict?.summary ?? "",
		row.note?.text ?? "",
	]
		.join(" ")
		.toLowerCase();
	return haystack.includes(term);
}

/** Applies every part of the filter except `skip`, which is how a facet counts its own options. */
function matches(row: PullRequestRow, filters: Filters, skip?: Facet): boolean {
	if (!filters.includeClosed && row.pullRequest.closedAt !== null) {
		return false;
	}
	if (!filters.includeSnoozed && row.derived.snoozed) {
		return false;
	}
	if (!matchesSearch(row, filters.search)) {
		return false;
	}
	if (!filters.flags.every((flag) => hasFlag(row, flag))) {
		return false;
	}
	return FACETS.every((facet) => {
		if (facet === skip) {
			return true;
		}
		const selected = filters.facets[facet];
		if (selected.length === 0) {
			return true;
		}
		const value = facetValue(row, facet);
		return value !== undefined && selected.includes(value);
	});
}

export function applyFilters(rows: PullRequestRow[], filters: Filters): PullRequestRow[] {
	return rows.filter((row) => matches(row, filters));
}

/**
 * How many rows each value of a facet would leave. Every other part of the filter is applied, so a
 * count says what happens if you click, not how many exist in total.
 */
export function facetCounts(
	rows: PullRequestRow[],
	filters: Filters,
	facet: Facet,
): Map<string, number> {
	const counts = new Map<string, number>();
	for (const row of rows) {
		if (!matches(row, filters, facet)) {
			continue;
		}
		const value = facetValue(row, facet);
		if (value !== undefined) {
			counts.set(value, (counts.get(value) ?? 0) + 1);
		}
	}
	return counts;
}

export function flagCounts(rows: PullRequestRow[], filters: Filters): Map<Flag, number> {
	const counts = new Map<Flag, number>();
	for (const flag of FLAGS) {
		const others = { ...filters, flags: filters.flags.filter((item) => item !== flag) };
		counts.set(flag, rows.filter((row) => matches(row, others) && hasFlag(row, flag)).length);
	}
	return counts;
}

export const SORT_KEYS = [
	"default",
	"number",
	"title",
	"nextAction",
	"area",
	"relevance",
	"status",
	"effort",
	"age",
	"lastActivity",
] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

const EFFORT_ORDER = ["XS", "S", "M", "L", "XL"];

function sortValue(row: PullRequestRow, key: SortKey): number | string {
	const verdict = row.assessment?.verdict;
	switch (key) {
		case "number": {
			return row.pullRequest.number;
		}
		case "title": {
			return row.pullRequest.title.toLowerCase();
		}
		case "nextAction": {
			return verdict ? nextActionRank(verdict.nextAction) : Number.MAX_SAFE_INTEGER;
		}
		case "area": {
			return verdict?.area ?? "￿";
		}
		case "relevance": {
			return verdict?.relevance ?? "￿";
		}
		case "status": {
			return verdict?.status ?? "￿";
		}
		case "effort": {
			return verdict ? EFFORT_ORDER.indexOf(verdict.effort) : Number.MAX_SAFE_INTEGER;
		}
		case "age": {
			return row.derived.ageDays;
		}
		case "lastActivity": {
			return row.derived.lastActivityDays;
		}
		default: {
			return 0;
		}
	}
}

/**
 * The default order is the one the design asks for: next action first, quick wins ahead of the
 * rest, then the most recently touched. Any other key sorts on that column and falls back to it.
 */
export function sortRows(
	rows: PullRequestRow[],
	key: SortKey,
	direction: SortDirection,
): PullRequestRow[] {
	const sign = direction === "asc" ? 1 : -1;
	return rows.toSorted((a, b) => {
		if (key !== "default") {
			const left = sortValue(a, key);
			const right = sortValue(b, key);
			if (left !== right) {
				return (left < right ? -1 : 1) * sign;
			}
		}
		return defaultOrder(a, b);
	});
}

function defaultOrder(a: PullRequestRow, b: PullRequestRow): number {
	const rankA = rank(a.assessment?.verdict?.nextAction);
	const rankB = rank(b.assessment?.verdict?.nextAction);
	if (rankA !== rankB) {
		return rankA - rankB;
	}
	if (a.derived.quickWin !== b.derived.quickWin) {
		return a.derived.quickWin ? -1 : 1;
	}
	return b.pullRequest.lastActivityAt.localeCompare(a.pullRequest.lastActivityAt);
}

function rank(action: NextAction | undefined): number {
	return action === undefined ? Number.MAX_SAFE_INTEGER : nextActionRank(action);
}
