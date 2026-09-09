/** Only pull requests exist today; issues are the planned next item kind (ADR 0004). */
export type ItemKind = "pull_request";

export const PULL_REQUEST: ItemKind = "pull_request";

/** Identifies one item. `kind` may be left out; it defaults to a pull request. */
export interface ItemRef {
	repository: string;
	kind?: ItemKind | undefined;
	number: number;
}

/** The same identity with every part filled in, as stored and as returned. */
export interface ResolvedItemRef {
	repository: string;
	kind: ItemKind;
	number: number;
}

export type ChecksState = "passing" | "failing" | "pending" | "none";

export interface ChecksSummary {
	state: ChecksState;
	passed: number;
	failed: number;
	pending: number;
}

/** Everything fetched deterministically from GitHub. Codex never judges these. */
export interface PullRequestFacts extends ResolvedItemRef {
	title: string;
	url: string;
	author: string;
	isBot: boolean;
	authoredByUser: boolean;
	reviewRequestedFromUser: boolean;
	createdAt: string;
	updatedAt: string;
	isDraft: boolean;
	labels: string[];
	headSha: string;
	baseRef: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	/** GitHub's raw value, for example `MERGEABLE`; null while GitHub is still computing it. */
	mergeable: string | null;
	/** GitHub's raw value, for example `APPROVED`; null when no review has happened. */
	reviewDecision: string | null;
	checks: ChecksSummary;
	lastActivityBy: string | null;
	lastActivityAt: string;
}

export interface StoredPullRequest extends PullRequestFacts {
	/** Set once the pull request stops appearing in the open list; the row is kept for a while. */
	closedAt: string | null;
	fetchedAt: string;
}

export type AssessmentDepth = "quick" | "thorough";

export type NextAction =
	"merge" | "review" | "continue" | "nudge_author" | "close" | "decide" | "wait";

export type Effort = "XS" | "S" | "M" | "L" | "XL";

export interface Evidence {
	note: string;
	url?: string | undefined;
}

/**
 * What Codex judged. `category`, `relevance` and `status` stay free strings here; the `assess`
 * module owns their vocabulary and the store only has to sort and filter on them.
 */
export interface AssessmentVerdict {
	nextAction: NextAction;
	nextActionReason: string;
	category: string;
	relevance: string;
	relevanceReason: string;
	status: string;
	statusReason: string;
	effort: Effort;
	effortReason: string;
	summary: string;
	confidence: number;
	evidence: Evidence[];
}

export interface NewAssessment extends ItemRef {
	depth: AssessmentDepth;
	/** The head commit the judgment was made against. */
	headSha: string;
	/** The pull request's `updated_at` at the time, so a later edit marks the assessment outdated. */
	updatedAtSeen: string;
	/** Null exactly when the pull request is unassessed, in which case `error` says why. */
	verdict: AssessmentVerdict | null;
	error?: string | null;
	model?: string | null;
	durationMs?: number | null;
	createdAt?: string;
}

export interface Assessment extends ResolvedItemRef {
	id: number;
	depth: AssessmentDepth;
	headSha: string;
	updatedAtSeen: string;
	verdict: AssessmentVerdict | null;
	error: string | null;
	model: string | null;
	durationMs: number | null;
	createdAt: string;
}

export interface Note extends ResolvedItemRef {
	text: string;
	updatedAt: string;
}

export interface Snooze extends ResolvedItemRef {
	/** Snoozed until the assessment with this id stops being the current one. */
	untilAssessmentId: number | null;
	/** Snoozed until this instant. */
	untilDate: string | null;
	createdAt: string;
}

export interface ReviewFinding {
	title: string;
	body: string;
	path?: string | undefined;
	line?: number | undefined;
	severity?: string | undefined;
}

export interface NewReviewDraft extends ItemRef {
	headSha: string;
	summary: string;
	verdict: string;
	findings: ReviewFinding[];
	/** The Codex session, kept so a follow-up can continue the same conversation. */
	sessionId: string | null;
	model?: string | null;
	createdAt?: string;
}

export interface ReviewDraft extends ResolvedItemRef {
	id: number;
	headSha: string;
	summary: string;
	verdict: string;
	findings: ReviewFinding[];
	sessionId: string | null;
	model: string | null;
	createdAt: string;
}

export type JobKind = "refresh" | "thorough_assessment" | "review_draft";

export type JobState = "queued" | "running" | "completed" | "aborted" | "failed";

export interface JobProgress {
	done: number;
	total: number;
	label?: string | undefined;
}

export interface NewJob {
	id: string;
	kind: JobKind;
	repository: string;
	/** The item the job is about; null for a whole-repository refresh. */
	number?: number | null;
	kindOfItem?: ItemKind | undefined;
	createdAt?: string;
}

export interface Job {
	id: string;
	kind: JobKind;
	repository: string;
	itemKind: ItemKind | null;
	number: number | null;
	state: JobState;
	progress: JobProgress | null;
	error: string | null;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
}

export type RefreshOutcome = "completed" | "aborted" | "failed";

export interface RefreshCounts {
	fetched: number;
	added: number;
	changed: number;
	reassessed: number;
	unassessed: number;
	closed: number;
}

export interface NewRefresh {
	repository: string;
	startedAt: string;
	finishedAt: string;
	outcome: RefreshOutcome;
	counts: RefreshCounts;
	error?: string | null;
}

export interface Refresh extends NewRefresh {
	id: number;
	error: string | null;
}

/** Thrown for problems the caller can act on, as opposed to SQLite errors leaking through. */
export class StoreError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "StoreError";
	}
}

export function resolveRef(ref: ItemRef): ResolvedItemRef {
	return { repository: ref.repository, kind: ref.kind ?? PULL_REQUEST, number: ref.number };
}

/** A snooze hides an item until its assessment is replaced, or until a date, whichever applies. */
export function isSnoozeActive(
	snooze: Snooze,
	context: { currentAssessmentId?: number | undefined; now: string },
): boolean {
	if (snooze.untilDate !== null) {
		return snooze.untilDate > context.now;
	}
	if (snooze.untilAssessmentId !== null) {
		return snooze.untilAssessmentId === context.currentAssessmentId;
	}
	return false;
}
