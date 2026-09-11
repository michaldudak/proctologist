import type { AgentKind } from "../agents/types.js";

/** The two kinds of item, sharing one table (ADR 0008). */
export type ItemKind = "pull_request" | "issue";

export const PULL_REQUEST = "pull_request" as const;
export const ISSUE = "issue" as const;

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

/** What both kinds of item carry. Fetched deterministically from GitHub; no agent judges these. */
export interface CommonFacts extends ResolvedItemRef {
	title: string;
	url: string;
	author: string;
	isBot: boolean;
	/**
	 * GitHub's raw author association, for example `MEMBER` or `FIRST_TIME_CONTRIBUTOR`. Rows fetched
	 * before it was recorded hold `NONE` until the next refresh.
	 */
	authorAssociation: string;
	authoredByUser: boolean;
	createdAt: string;
	/** GitHub's own timestamp, which moves for anything at all, a reaction included. */
	updatedAt: string;
	/**
	 * When the item last changed in a way that could change a judgment. For a pull request that is
	 * GitHub's `updated_at`; for an issue it is the latest of the body being edited, a human
	 * commenting and the issue being reopened, because an issue's `updated_at` moves for labels,
	 * assignees and reactions and would otherwise leave every issue permanently due.
	 */
	changedAt: string;
	labels: string[];
	lastActivityBy: string | null;
	lastActivityAt: string;
}

/** Everything fetched about a pull request. The columns behind these are null for an issue. */
export interface PullRequestFacts extends CommonFacts {
	kind: "pull_request";
	reviewRequestedFromUser: boolean;
	isDraft: boolean;
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
}

/** Everything fetched about an issue. The columns behind these are null for a pull request. */
export interface IssueFacts extends CommonFacts {
	kind: "issue";
	assignees: string[];
	milestone: string | null;
	/** How many comments the thread holds, so triage knows what it was not handed. */
	comments: number;
	/** Pull requests GitHub reports as closing this issue. */
	linkedPullRequests: number[];
	/** GitHub's reason for the close: `COMPLETED`, `NOT_PLANNED`, `DUPLICATE`. Null while open. */
	stateReason: string | null;
}

/** One item of either kind. Narrow on `kind` to reach what only one of them has. */
export type ItemFacts = PullRequestFacts | IssueFacts;

export function isPullRequest<T extends { kind: ItemKind }>(
	item: T,
): item is T & { kind: "pull_request" } {
	return item.kind === PULL_REQUEST;
}

export function isIssue<T extends { kind: ItemKind }>(item: T): item is T & { kind: "issue" } {
	return item.kind === ISSUE;
}

/** The associations that make an author a maintainer of the repository rather than an outsider. */
const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function isMaintainerAssociation(association: string): boolean {
	return MAINTAINER_ASSOCIATIONS.has(association);
}

interface StoredExtras {
	/** Set once the item stops appearing in the open list; the row is kept for a while. */
	closedAt: string | null;
	fetchedAt: string;
}

export type StoredPullRequest = PullRequestFacts & StoredExtras;
export type StoredIssue = IssueFacts & StoredExtras;
export type StoredItem = StoredPullRequest | StoredIssue;

export type AssessmentDepth = "quick" | "thorough";

export type PullRequestNextAction =
	"merge" | "review" | "continue" | "nudge_author" | "close" | "decide" | "wait";

export type IssueNextAction =
	"fix" | "answer" | "reproduce" | "request_info" | "close" | "decide" | "wait";

/** Either kind's vocabulary. Which one applies is the item's kind, not the verdict's business. */
export type NextAction = PullRequestNextAction | IssueNextAction;

export type Effort = "XS" | "S" | "M" | "L" | "XL";

export type Priority = "critical" | "high" | "medium" | "low";

export interface Evidence {
	note: string;
	url?: string | undefined;
}

/**
 * What the agent judged. `area`, `relevance` and `status` stay free strings here; the `assess`
 * module owns their vocabulary and the store only has to sort and filter on them.
 */
export interface AssessmentVerdict {
	nextAction: NextAction;
	nextActionReason: string;
	area: string;
	relevance: string;
	relevanceReason: string;
	status: string;
	statusReason: string;
	effort: Effort;
	effortReason: string;
	/** Null for assessments made before the agent was asked to judge priority. */
	priority: Priority | null;
	priorityReason: string;
	summary: string;
	confidence: number;
	evidence: Evidence[];
	/** Issues this one may duplicate, proposed from the index of open titles. Empty on a pull request. */
	possibleDuplicateOf: number[];
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
	/** Which agent judged it. Null for assessments made before the app had more than one. */
	agent?: AgentKind | null;
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
	agent: AgentKind | null;
	model: string | null;
	durationMs: number | null;
	createdAt: string;
}

/**
 * The long-form explanation a thorough assessment writes beside its verdict: Markdown with Mermaid
 * diagrams. Kept with the assessment it came from, and still worth reading once that assessment
 * has been replaced by a quick one, which is why it carries what it was written against.
 */
export interface Analysis extends ResolvedItemRef {
	assessmentId: number;
	markdown: string;
	/** The head commit the analysis describes. */
	headSha: string;
	agent: AgentKind | null;
	model: string | null;
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
	/** The agent's session, kept so a follow-up can continue the same conversation. */
	sessionId: string | null;
	agent?: AgentKind | null;
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
	agent: AgentKind | null;
	model: string | null;
	createdAt: string;
}

/**
 * A refresh fetches; an assessment judges what the refresh found due, one pull request at a time.
 * They are separate jobs so the list is up to date the moment GitHub has answered, and so the
 * judging can be watched and stopped on its own.
 */
export type JobKind = "refresh" | "assessment" | "thorough_assessment" | "review_draft";

export type JobState = "queued" | "running" | "completed" | "aborted" | "failed";

export interface JobProgress {
	done: number;
	total: number;
	label?: string | undefined;
	/** Of the ones done, how many ended without a valid result. */
	failed?: number | undefined;
}

export interface NewJob {
	id: string;
	kind: JobKind;
	repository: string;
	/** The item the job is about; null for a whole-repository refresh. */
	number?: number | null;
	kindOfItem?: ItemKind | undefined;
	/** The job that queued this one, when it was queued by another job rather than by the user. */
	parentId?: string | null;
	/** Known before the job starts, for one whose size is decided when it is queued. */
	progress?: JobProgress | null;
	createdAt?: string;
}

export interface Job {
	id: string;
	kind: JobKind;
	repository: string;
	itemKind: ItemKind | null;
	number: number | null;
	parentId: string | null;
	state: JobState;
	progress: JobProgress | null;
	error: string | null;
	createdAt: string;
	startedAt: string | null;
	finishedAt: string | null;
}

export type RefreshOutcome = "completed" | "aborted" | "failed";

/** What a refresh found. Assessing what it found is a separate job with a count of its own. */
export interface RefreshCounts {
	fetched: number;
	added: number;
	changed: number;
	closed: number;
	/** Open pull requests with no current assessment after this refresh. */
	due: number;
}

export interface NewRefresh {
	repository: string;
	startedAt: string;
	finishedAt: string;
	outcome: RefreshOutcome;
	counts: RefreshCounts;
	error?: string | null;
	/**
	 * What sort of failure it was, so the app can say whether trying again is likely to help.
	 * Matches `GitHubError["kind"]` where the failure came from `gh`.
	 */
	errorKind?: string | null;
}

export interface Refresh extends Omit<NewRefresh, "error" | "errorKind"> {
	id: number;
	error: string | null;
	errorKind: string | null;
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
