/**
 * The vocabulary the agent judges against. Values are stored; labels are what the UI shows. Changing a
 * value means migrating stored assessments, so add rather than rename.
 */

export const NEXT_ACTIONS = {
	merge: "Merge",
	review: "Review",
	continue: "Continue",
	nudge_author: "Nudge author",
	close: "Close",
	decide: "Decide",
	wait: "Wait",
} as const;

export const CATEGORIES = {
	feature: "Feature",
	bug_fix: "Bug fix",
	experiment: "Experiment",
	refactor_chore: "Refactor or chore",
	docs: "Docs",
	dependency_infra: "Dependency or infrastructure",
	test: "Test",
	other: "Other",
} as const;

export const RELEVANCES = {
	still_relevant: "Still relevant",
	possibly_obsolete: "Possibly obsolete",
	likely_obsolete: "Likely obsolete",
	unclear: "Unclear",
} as const;

export const STATUSES = {
	ready_to_merge: "Ready to merge",
	waiting_on_maintainer: "Waiting on maintainer",
	waiting_on_author: "Waiting on author",
	blocked_on_discussion: "Blocked on discussion",
	stalled: "Stalled",
} as const;

export const EFFORTS = {
	XS: "XS",
	S: "S",
	M: "M",
	L: "L",
	XL: "XL",
} as const;

export const NEXT_ACTION_VALUES = Object.keys(NEXT_ACTIONS) as (keyof typeof NEXT_ACTIONS)[];
export const CATEGORY_VALUES = Object.keys(CATEGORIES) as (keyof typeof CATEGORIES)[];
export const RELEVANCE_VALUES = Object.keys(RELEVANCES) as (keyof typeof RELEVANCES)[];
export const STATUS_VALUES = Object.keys(STATUSES) as (keyof typeof STATUSES)[];
export const EFFORT_VALUES = Object.keys(EFFORTS) as (keyof typeof EFFORTS)[];

export type Category = keyof typeof CATEGORIES;
export type Relevance = keyof typeof RELEVANCES;
export type Status = keyof typeof STATUSES;
