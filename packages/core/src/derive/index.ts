import {
	isSnoozeActive,
	type Assessment,
	type AssessmentVerdict,
	type Effort,
	type NextAction,
	type Snooze,
	type StoredPullRequest,
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

const QUICK_WIN_ACTIONS = new Set<NextAction>(["merge", "review"]);
const QUICK_WIN_EFFORTS = new Set<Effort>(["XS", "S"]);

export function nextActionRank(action: NextAction): number {
	const rank = NEXT_ACTION_ORDER.indexOf(action);
	return rank === -1 ? NEXT_ACTION_ORDER.length : rank;
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
	pullRequest: StoredPullRequest;
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
		ageDays: ageInDays(view.pullRequest.createdAt, now),
		lastActivityDays: ageInDays(view.pullRequest.lastActivityAt, now),
		assessmentOutdated:
			assessment !== undefined &&
			(assessment.headSha !== view.pullRequest.headSha ||
				assessment.updatedAtSeen !== view.pullRequest.updatedAt),
	};
}

/** Default table order: next action first, then quick wins, then the most recently touched. */
export function compareForTable(
	a: PullRequestView & { derived: DerivedFields },
	b: PullRequestView & { derived: DerivedFields },
): number {
	const rankA = a.assessment?.verdict ? nextActionRank(a.assessment.verdict.nextAction) : 99;
	const rankB = b.assessment?.verdict ? nextActionRank(b.assessment.verdict.nextAction) : 99;
	if (rankA !== rankB) {
		return rankA - rankB;
	}
	if (a.derived.quickWin !== b.derived.quickWin) {
		return a.derived.quickWin ? -1 : 1;
	}
	return b.pullRequest.lastActivityAt.localeCompare(a.pullRequest.lastActivityAt);
}
