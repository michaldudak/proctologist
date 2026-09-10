import {
	AREAS,
	EFFORTS,
	NEXT_ACTIONS,
	RELEVANCES,
	STATUSES,
	type Area,
	type Effort,
	type NextAction,
	type Relevance,
	type Status,
} from "@proctologist/core/browser";
import type { Facet, Flag } from "./filters.js";

const FACET_LABELS: Record<Facet, string> = {
	author: "Author",
	nextAction: "Next action",
	area: "Area",
	relevance: "Relevance",
	status: "Status",
	effort: "Effort",
};

const FLAG_LABELS: Record<Flag, string> = {
	quickWin: "Quick wins",
	unassessed: "Unassessed",
	changed: "Changed",
	reviewRequested: "Review requested",
	mine: "Yours",
	draft: "Drafts",
	notDraft: "Non-drafts",
	bot: "Bots",
	note: "With a note",
};

/** Logins are their own label, so the author facet has no vocabulary to look up. */
const VALUE_LABELS: Record<Facet, Record<string, string>> = {
	author: {},
	nextAction: NEXT_ACTIONS,
	area: AREAS,
	relevance: RELEVANCES,
	status: STATUSES,
	effort: EFFORTS,
};

/** The verdict fields `changedVerdicts` reports, in words rather than property names. */
const VERDICT_FIELD_LABELS: Record<string, string> = {
	nextAction: "next action",
	area: "area",
	relevance: "relevance",
	status: "status",
	effort: "effort",
};

export function verdictFieldLabel(field: string): string {
	return VERDICT_FIELD_LABELS[field] ?? field;
}

export function facetLabel(facet: Facet): string {
	return FACET_LABELS[facet];
}

export function flagLabel(flag: Flag): string {
	return FLAG_LABELS[flag];
}

/** Turns a stored value into what the user reads, and keeps unknown values legible. */
export function valueLabel(facet: Facet, value: string): string {
	return VALUE_LABELS[facet][value] ?? value;
}

export function nextActionLabel(action: NextAction): string {
	return NEXT_ACTIONS[action] ?? action;
}

export function areaLabel(area: string): string {
	return AREAS[area as Area] ?? area;
}

export function relevanceLabel(relevance: string): string {
	return RELEVANCES[relevance as Relevance] ?? relevance;
}

export function statusLabel(status: string): string {
	return STATUSES[status as Status] ?? status;
}

export function effortLabel(effort: string): string {
	return EFFORTS[effort as Effort] ?? effort;
}

/** Compact age, the way a maintainer scanning a table reads it: 3d, 5w, 14mo. */
export function shortDuration(days: number): string {
	if (days <= 0) {
		return "today";
	}
	if (days < 14) {
		return `${String(days)}d`;
	}
	if (days < 60) {
		return `${String(Math.round(days / 7))}w`;
	}
	if (days < 365) {
		return `${String(Math.round(days / 30))}mo`;
	}
	const years = days / 365;
	return `${years < 10 ? years.toFixed(1) : String(Math.round(years))}y`;
}

export function absoluteDate(iso: string): string {
	return new Date(iso).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});
}

/** Calendar days apart, not hours: 11pm and 1am are a day apart however few minutes separate them. */
function daysAgo(then: Date, now: Date): number {
	const startOfThen = new Date(then.getFullYear(), then.getMonth(), then.getDate());
	const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((startOfNow.getTime() - startOfThen.getTime()) / 86_400_000);
}

/**
 * The last refresh, as the user thinks of it. Within the last two days the day name is the whole
 * answer and the clock time is what they actually want; before that the date carries it.
 */
export function refreshedAt(iso: string, now: Date = new Date()): string {
	const at = new Date(iso);
	const time = at.toLocaleTimeString(undefined, { timeStyle: "short" });

	switch (daysAgo(at, now)) {
		case 0: {
			return `Today at ${time}`;
		}
		case 1: {
			return `Yesterday at ${time}`;
		}
		default: {
			return absoluteDate(iso);
		}
	}
}

/** How the check rollup reads in a cell. */
export function checksLabel(checks: {
	state: string;
	passed: number;
	failed: number;
	pending: number;
}): string {
	switch (checks.state) {
		case "passing": {
			return `${String(checks.passed)} passing`;
		}
		case "failing": {
			return `${String(checks.failed)} failing`;
		}
		case "pending": {
			return `${String(checks.pending)} running`;
		}
		default: {
			return "no checks";
		}
	}
}

export function reviewDecisionLabel(decision: string | null): string | null {
	switch (decision) {
		case "APPROVED": {
			return "Approved";
		}
		case "CHANGES_REQUESTED": {
			return "Changes requested";
		}
		case "REVIEW_REQUIRED": {
			return "Review required";
		}
		default: {
			return null;
		}
	}
}
