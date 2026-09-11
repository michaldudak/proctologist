import {
	isPullRequest,
	isSnoozeActive,
	type Assessment,
	type AssessmentVerdict,
	type Effort,
	type NextAction,
	type Priority,
	type Snooze,
	type ItemKind,
	type StoredItem,
	ISSUE,
	PULL_REQUEST,
} from "../store/types.js";

/** Sort order for the default view: what the user should deal with first (DESIGN.md). */
export const NEXT_ACTION_ORDER: NextAction[] = [
	"merge",
	"review",
	"continue",
	"close",
	"nudge_author",
	"decide",
	"wait",
];

/**
 * The same idea for issues: what the maintainer can act on now first, then what needs someone
 * else, then what needs a decision. Close sits late rather than early, unlike a pull request's,
 * because closing an issue is usually the end of a conversation rather than a tidy-up.
 */
export const ISSUE_NEXT_ACTION_ORDER: NextAction[] = [
	"fix",
	"answer",
	"reproduce",
	"request_info",
	"decide",
	"close",
	"wait",
];

/** Most pressing first. An assessment without a priority sorts after every one that has one. */
export const PRIORITY_ORDER: Priority[] = ["critical", "high", "medium", "low"];

/** The actions whose work is the maintainer's own to do, for either kind. */
const QUICK_WIN_ACTIONS = new Set<NextAction>(["merge", "review", "fix", "answer"]);
const QUICK_WIN_EFFORTS = new Set<Effort>(["XS", "S"]);

/**
 * Where an action sits in its kind's order. The kind has to be given: the two vocabularies overlap
 * on close, decide and wait, and an issue's close belongs late where a pull request's belongs
 * early, so the action alone cannot say which order applies.
 */
export function nextActionRank(action: NextAction, kind: ItemKind = PULL_REQUEST): number {
	const order = kind === ISSUE ? ISSUE_NEXT_ACTION_ORDER : NEXT_ACTION_ORDER;
	const rank = order.indexOf(action);
	return rank === -1 ? order.length : rank;
}

export function priorityRank(priority: Priority | null | undefined): number {
	const rank = priority === null || priority === undefined ? -1 : PRIORITY_ORDER.indexOf(priority);
	return rank === -1 ? PRIORITY_ORDER.length : rank;
}

/** A pull request worth doing right now: little work, and the work is the user's to do. */
export function isQuickWin(verdict: AssessmentVerdict | null | undefined): boolean {
	return (
		verdict !== null &&
		verdict !== undefined &&
		QUICK_WIN_ACTIONS.has(verdict.nextAction) &&
		QUICK_WIN_EFFORTS.has(verdict.effort)
	);
}

export const VERDICT_FIELDS = [
	"nextAction",
	"area",
	"relevance",
	"status",
	"effort",
	"priority",
] as const satisfies readonly (keyof AssessmentVerdict)[];

export type VerdictField = (typeof VERDICT_FIELDS)[number];

/**
 * Which verdicts differ between an assessment and the one it replaced. Reasons and summaries are
 * ignored: they are reworded on every run and would mark everything as changed.
 */
export function changedVerdicts(
	current: Assessment | undefined,
	previous: Assessment | undefined,
): VerdictField[] {
	if (!current?.verdict || !previous?.verdict) {
		return [];
	}
	const before = previous.verdict;
	const after = current.verdict;
	return VERDICT_FIELDS.filter((field) => before[field] !== after[field]);
}

/** Whole days between two instants, rounded down. */
export function ageInDays(from: string, now: string): number {
	return Math.max(0, Math.floor((Date.parse(now) - Date.parse(from)) / 86_400_000));
}

/** A snooze hides an item until its assessment is replaced, or until a date. */
export function isSnoozed(
	snooze: Snooze | undefined,
	context: { currentAssessmentId?: number | undefined; now: string },
): boolean {
	return snooze !== undefined && isSnoozeActive(snooze, context);
}

/** Everything the table needs about one row, assembled from the parts the store keeps. */
export interface PullRequestView {
	item: StoredItem;
	assessment: Assessment | undefined;
	previousAssessment: Assessment | undefined;
	hasNote: boolean;
	snooze: Snooze | undefined;
}

export interface DerivedFields {
	quickWin: boolean;
	unassessed: boolean;
	changed: VerdictField[];
	snoozed: boolean;
	ageDays: number;
	lastActivityDays: number;
	/** Whether the assessment predates the pull request's current state. */
	assessmentOutdated: boolean;
}

export function derive(view: PullRequestView, now: string): DerivedFields {
	const assessment = view.assessment;
	return {
		quickWin: isQuickWin(assessment?.verdict),
		unassessed: assessment === undefined || assessment.verdict === null,
		changed: changedVerdicts(assessment, view.previousAssessment),
		snoozed: isSnoozed(view.snooze, { currentAssessmentId: assessment?.id, now }),
		ageDays: ageInDays(view.item.createdAt, now),
		lastActivityDays: ageInDays(view.item.lastActivityAt, now),
		assessmentOutdated:
			assessment !== undefined &&
			(assessment.updatedAtSeen !== view.item.changedAt ||
				(isPullRequest(view.item) && assessment.headSha !== view.item.headSha)),
	};
}

/**
 * Default table order: next action first, then quick wins, then the most pressing, then the most
 * recently touched.
 */
export function compareForTable(
	a: PullRequestView & { derived: DerivedFields },
	b: PullRequestView & { derived: DerivedFields },
): number {
	const rankA = a.assessment?.verdict
		? nextActionRank(a.assessment.verdict.nextAction, a.item.kind)
		: 99;
	const rankB = b.assessment?.verdict
		? nextActionRank(b.assessment.verdict.nextAction, b.item.kind)
		: 99;
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
