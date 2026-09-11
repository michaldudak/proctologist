import type { NextAction } from "@proctologist/core/browser";
import {
	isIssue,
	isMaintainerAssociation,
	isPullRequest,
	nextActionRank,
	priorityRank,
} from "@proctologist/core/browser";
import type { ItemRow } from "../../../shared/ipc.js";

/**
 * Facets the filter bar filters on. All but the author are values the assessment can hold; the
 * author is a fact, so it is there whether the pull request has been assessed or not.
 */
export const FACETS = [
	"repository",
	"author",
	"type",
	"nextAction",
	"priority",
	"area",
	"relevance",
	"status",
	"effort",
] as const;
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
	"maintainer",
	"external",
	"note",
	"assigned",
	"noReply",
	"linked",
	"firstTimeReporter",
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
	facets: {
		repository: [],
		author: [],
		type: [],
		nextAction: [],
		priority: [],
		area: [],
		relevance: [],
		status: [],
		effort: [],
	},
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

function facetValue(row: ItemRow, facet: Facet): string | undefined {
	if (facet === "author") {
		return row.item.author;
	}
	if (facet === "repository") {
		return row.item.repository;
	}
	const verdict = row.assessment?.verdict;
	if (!verdict) {
		return undefined;
	}
	switch (facet) {
		case "type": {
			return verdict.type ?? undefined;
		}
		case "nextAction": {
			return verdict.nextAction;
		}
		case "priority": {
			return verdict.priority ?? undefined;
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

export function hasFlag(row: ItemRow, flag: Flag): boolean {
	switch (flag) {
		case "assigned": {
			return isIssue(row.item) && row.item.assignees.length > 0;
		}
		case "noReply": {
			return isIssue(row.item) && row.item.comments === 0;
		}
		case "linked": {
			return isIssue(row.item) && row.item.linkedPullRequests.length > 0;
		}
		case "firstTimeReporter": {
			return row.item.authorAssociation.startsWith("FIRST_TIME");
		}
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
			return isPullRequest(row.item) && row.item.reviewRequestedFromUser;
		}
		case "mine": {
			return row.item.authoredByUser;
		}
		case "draft": {
			return isPullRequest(row.item) && row.item.isDraft;
		}
		case "notDraft": {
			return isPullRequest(row.item) && !row.item.isDraft;
		}
		case "bot": {
			return row.item.isBot;
		}
		case "maintainer": {
			return isMaintainerAssociation(row.item.authorAssociation);
		}
		case "external": {
			// Bots are neither: they are their own option.
			return !row.item.isBot && !isMaintainerAssociation(row.item.authorAssociation);
		}
		default: {
			return row.note !== null;
		}
	}
}

function matchesSearch(row: ItemRow, search: string): boolean {
	const term = search.trim().toLowerCase();
	if (term === "") {
		return true;
	}
	const haystack = [
		String(row.item.number),
		row.item.title,
		row.item.author,
		...row.item.labels,
		row.assessment?.verdict?.summary ?? "",
		row.note?.text ?? "",
	]
		.join(" ")
		.toLowerCase();
	return haystack.includes(term);
}

/** Applies every part of the filter except `skip`, which is how a facet counts its own options. */
function matches(row: ItemRow, filters: Filters, skip?: Facet): boolean {
	if (!filters.includeClosed && row.item.closedAt !== null) {
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

export function applyFilters(rows: ItemRow[], filters: Filters): ItemRow[] {
	return rows.filter((row) => matches(row, filters));
}

/**
 * How many rows each value of a facet would leave. Every other part of the filter is applied, so a
 * count says what happens if you click, not how many exist in total.
 */
export function facetCounts(rows: ItemRow[], filters: Filters, facet: Facet): Map<string, number> {
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

export function flagCounts(rows: ItemRow[], filters: Filters): Map<Flag, number> {
	const counts = new Map<Flag, number>();
	for (const flag of FLAGS) {
		const others = { ...filters, flags: filters.flags.filter((item) => item !== flag) };
		counts.set(flag, rows.filter((row) => matches(row, others) && hasFlag(row, flag)).length);
	}
	return counts;
}

export const SORT_KEYS = [
	"default",
	"repository",
	"number",
	"title",
	"author",
	"type",
	"comments",
	"nextAction",
	"priority",
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

function sortValue(row: ItemRow, key: SortKey): number | string {
	const verdict = row.assessment?.verdict;
	switch (key) {
		case "number": {
			return row.item.number;
		}
		case "title": {
			return row.item.title.toLowerCase();
		}
		case "author": {
			return row.item.author.toLowerCase();
		}
		case "nextAction": {
			return verdict ? nextActionRank(verdict.nextAction) : Number.MAX_SAFE_INTEGER;
		}
		case "priority": {
			return verdict ? priorityRank(verdict.priority) : Number.MAX_SAFE_INTEGER;
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
		case "repository": {
			return row.item.repository;
		}
		case "type": {
			return verdict?.type ?? "";
		}
		case "comments": {
			return isIssue(row.item) ? row.item.comments : 0;
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
 * rest, then the most pressing, then the most recently touched. Any other key sorts on that column
 * and falls back to it.
 */
export function sortRows(rows: ItemRow[], key: SortKey, direction: SortDirection): ItemRow[] {
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

function defaultOrder(a: ItemRow, b: ItemRow): number {
	const rankA = rank(a.assessment?.verdict?.nextAction);
	const rankB = rank(b.assessment?.verdict?.nextAction);
	if (rankA !== rankB) {
		return rankA - rankB;
	}
	if (a.derived.quickWin !== b.derived.quickWin) {
		return a.derived.quickWin ? -1 : 1;
	}
	const priorityA = priorityRank(a.assessment?.verdict?.priority);
	const priorityB = priorityRank(b.assessment?.verdict?.priority);
	if (priorityA !== priorityB) {
		return priorityA - priorityB;
	}
	return b.item.lastActivityAt.localeCompare(a.item.lastActivityAt);
}

function rank(action: NextAction | undefined): number {
	return action === undefined ? Number.MAX_SAFE_INTEGER : nextActionRank(action);
}

/** Facets that mean nothing for one kind: a pull request has no type, and one repo has no scope. */
const FACETS_BY_KIND: Record<"pull_request" | "issue", readonly Facet[]> = {
	pull_request: FACETS.filter((facet) => facet !== "type"),
	issue: FACETS,
};

const FLAGS_BY_KIND: Record<"pull_request" | "issue", readonly Flag[]> = {
	pull_request: FLAGS.filter(
		(flag) => !["assigned", "noReply", "linked", "firstTimeReporter"].includes(flag),
	),
	issue: FLAGS.filter((flag) => !["reviewRequested", "draft", "notDraft"].includes(flag)),
};

export function facetsFor(
	kind: "pull_request" | "issue",
	allRepositories: boolean,
): readonly Facet[] {
	return FACETS_BY_KIND[kind].filter((facet) => facet !== "repository" || allRepositories);
}

export function flagsFor(kind: "pull_request" | "issue"): readonly Flag[] {
	return FLAGS_BY_KIND[kind];
}
