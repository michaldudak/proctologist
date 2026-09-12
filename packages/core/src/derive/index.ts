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
	// Seconds of work that takes an issue off the list for good, so it sits with the other two the
	// maintainer can act on without leaving their chair.
	"close_duplicate",
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

/**
 * How sure a text-only judgment has to be before it is promoted. An issue's effort and relevance
 * are estimates read off prose, so a shaky one belongs in the list rather than at the top of it.
 */
const QUICK_WIN_CONFIDENCE = 0.5;

/**
 * An item worth doing right now: little work, and the work is the user's to do.
 *
 * Closing a duplicate is a quick win on its own terms rather than by effort — the effort judged is
 * the change the issue asks for, which is exactly the work that is not going to happen. What it
 * costs is a comment and a click.
 */
export function isQuickWin(
	verdict: AssessmentVerdict | null | undefined,
	kind: ItemKind = PULL_REQUEST,
): boolean {
	if (verdict === null || verdict === undefined) {
		return false;
	}
	const littleWork =
		verdict.nextAction === "close_duplicate" ||
		(QUICK_WIN_ACTIONS.has(verdict.nextAction) && QUICK_WIN_EFFORTS.has(verdict.effort));
	if (!littleWork) {
		return false;
	}
	return kind !== ISSUE || verdict.confidence >= QUICK_WIN_CONFIDENCE;
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
	/**
	 * Whether an assessment is owed: never made, failed, overtaken by a change, or past the
	 * cut-off. The same four reasons the refresh counts, so the Due filter and the Assess button
	 * agree on what is outstanding.
	 */
	due: boolean;
}

export interface DeriveOptions {
	/** After how many days a standing assessment is stale, from the config of the same name. */
	outdatedAfterDays: number;
}

export function derive(view: PullRequestView, now: string, options: DeriveOptions): DerivedFields {
	const assessment = view.assessment;
	const unassessed = assessment === undefined || assessment.verdict === null;
	const assessmentOutdated =
		assessment !== undefined &&
		(assessment.updatedAtSeen !== view.item.changedAt ||
			(isPullRequest(view.item) && assessment.headSha !== view.item.headSha));
	return {
		quickWin: isQuickWin(assessment?.verdict, view.item.kind),
		unassessed,
		changed: changedVerdicts(assessment, view.previousAssessment),
		snoozed: isSnoozed(view.snooze, { currentAssessmentId: assessment?.id, now }),
		ageDays: ageInDays(view.item.createdAt, now),
		lastActivityDays: ageInDays(view.item.lastActivityAt, now),
		assessmentOutdated,
		due:
			unassessed || assessmentOutdated || isPastCutOff(assessment, now, options.outdatedAfterDays),
	};
}

/**
 * Whether a standing assessment has aged out. Closed items never reach here: the refresh only
 * counts open ones, and the table hides the closed unless asked for them.
 */
function isPastCutOff(
	assessment: Assessment | undefined,
	now: string,
	outdatedAfterDays: number,
): boolean {
	if (assessment === undefined) {
		return false;
	}
	const cutOff = new Date(now).getTime() - outdatedAfterDays * 86_400_000;
	return new Date(assessment.createdAt).getTime() < cutOff;
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
