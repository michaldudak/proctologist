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

export const AREAS = {
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

/**
 * Urgency and importance together, judged on their own: a pull request the maintainer should close
 * can still be critical if leaving it open costs something, and a merge-ready one can be low.
 */
export const PRIORITIES = {
	critical: "Critical",
	high: "High",
	medium: "Medium",
	low: "Low",
} as const;

export const EFFORTS = {
	XS: "XS",
	S: "S",
	M: "M",
	L: "L",
	XL: "XL",
} as const;

export const NEXT_ACTION_VALUES = Object.keys(NEXT_ACTIONS) as (keyof typeof NEXT_ACTIONS)[];
export const AREA_VALUES = Object.keys(AREAS) as (keyof typeof AREAS)[];
export const RELEVANCE_VALUES = Object.keys(RELEVANCES) as (keyof typeof RELEVANCES)[];
export const STATUS_VALUES = Object.keys(STATUSES) as (keyof typeof STATUSES)[];
export const PRIORITY_VALUES = Object.keys(PRIORITIES) as (keyof typeof PRIORITIES)[];
export const EFFORT_VALUES = Object.keys(EFFORTS) as (keyof typeof EFFORTS)[];

export type Area = keyof typeof AREAS;
export type Relevance = keyof typeof RELEVANCES;
export type Status = keyof typeof STATUSES;

/** What the maintainer should do about an issue. Merge and Continue have no meaning here. */
export const ISSUE_NEXT_ACTIONS = {
	fix: "Fix",
	answer: "Answer",
	reproduce: "Reproduce",
	request_info: "Request info",
	close: "Close",
	decide: "Decide",
	wait: "Wait",
} as const;

/** Where an issue is stuck. A pull request's statuses are all about merging, so none carry over. */
export const ISSUE_STATUSES = {
	needs_reproduction: "Needs reproduction",
	awaiting_reporter: "Awaiting reporter",
	accepted: "Accepted",
	blocked_on_discussion: "Blocked on discussion",
	stalled: "Stalled",
} as const;

/**
 * What kind of thing an issue is: the first way a maintainer sorts a backlog, and something `area`
 * does not capture. Pull requests have no type.
 */
export const ISSUE_TYPES = {
	bug: "Bug",
	feature_request: "Feature request",
	question: "Question",
	documentation: "Documentation",
	discussion: "Discussion",
} as const;

export const ISSUE_NEXT_ACTION_VALUES = Object.keys(
	ISSUE_NEXT_ACTIONS,
) as (keyof typeof ISSUE_NEXT_ACTIONS)[];
export const ISSUE_STATUS_VALUES = Object.keys(ISSUE_STATUSES) as (keyof typeof ISSUE_STATUSES)[];
export const ISSUE_TYPE_VALUES = Object.keys(ISSUE_TYPES) as (keyof typeof ISSUE_TYPES)[];

export type IssueStatus = keyof typeof ISSUE_STATUSES;
export type IssueType = keyof typeof ISSUE_TYPES;

/** Every next action either kind can carry, for the renderer's labels and filters. */
export const ALL_NEXT_ACTIONS = { ...NEXT_ACTIONS, ...ISSUE_NEXT_ACTIONS } as const;
export const ALL_STATUSES = { ...STATUSES, ...ISSUE_STATUSES } as const;
