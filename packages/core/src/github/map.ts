import type { ChecksSummary, IssueFacts, PullRequestFacts } from "../store/types.js";
import type {
	CheckContextNode,
	GraphQlActor,
	IssueFactsNode,
	PullRequestFactsNode,
} from "./schema.js";

export interface MapOptions {
	repository: string;
	/** The login `gh` is authenticated as, used for "yours" and "review requested". */
	viewerLogin: string;
}

/** Turns one GraphQL pull request node into the facts the rest of the app works with. */
export function toPullRequestFacts(
	node: PullRequestFactsNode,
	options: MapOptions,
): PullRequestFacts {
	const author = node.author?.login ?? "ghost";
	const activity = lastActivity(node);

	return {
		repository: options.repository,
		kind: "pull_request",
		number: node.number,
		title: node.title,
		url: node.url,
		author,
		isBot: isBot(node.author),
		authorAssociation: node.authorAssociation,
		authoredByUser: author === options.viewerLogin,
		reviewRequestedFromUser: reviewRequestedFrom(node, options.viewerLogin),
		createdAt: node.createdAt,
		// A pull request moves for commits and edits, so GitHub's own timestamp is the honest one.
		changedAt: node.updatedAt,
		updatedAt: node.updatedAt,
		isDraft: node.isDraft,
		labels: (node.labels?.nodes ?? []).map((label) => label.name),
		headSha: node.headRefOid,
		baseRef: node.baseRefName,
		additions: node.additions,
		deletions: node.deletions,
		changedFiles: node.changedFiles,
		mergeable: node.mergeable,
		reviewDecision: node.reviewDecision,
		checks: summariseChecks(node),
		lastActivityBy: activity.by,
		lastActivityAt: activity.at,
	};
}

/**
 * GitHub marks apps with the `Bot` type, but plenty of automation runs as a user account whose
 * login ends in `[bot]`, so both are treated the same.
 */
export function isBot(actor: GraphQlActor | null | undefined): boolean {
	if (!actor) {
		return false;
	}
	return actor.__typename === "Bot" || (actor.login?.endsWith("[bot]") ?? false);
}

function reviewRequestedFrom(node: PullRequestFactsNode, viewerLogin: string): boolean {
	return (node.reviewRequests?.nodes ?? []).some(
		(request) =>
			request !== null &&
			request.requestedReviewer?.__typename === "User" &&
			request.requestedReviewer.login === viewerLogin,
	);
}

/**
 * The most recent thing that happened on the pull request, taken from the last comment, review and
 * commit. `updatedAt` alone is no good: label changes bump it without anyone having said anything.
 */
function lastActivity(node: PullRequestFactsNode): { at: string; by: string | null } {
	const candidates: { at: string; by: string | null }[] = [
		{ at: node.createdAt, by: node.author?.login ?? null },
	];

	for (const comment of node.comments?.nodes ?? []) {
		if (comment) {
			candidates.push({ at: comment.createdAt, by: comment.author?.login ?? null });
		}
	}
	for (const review of node.reviews?.nodes ?? []) {
		if (review?.submittedAt) {
			candidates.push({ at: review.submittedAt, by: review.author?.login ?? null });
		}
	}
	for (const entry of node.commits?.nodes ?? []) {
		if (entry) {
			candidates.push({
				at: entry.commit.committedDate,
				by: entry.commit.author?.user?.login ?? null,
			});
		}
	}

	return candidates.reduce((latest, candidate) => (candidate.at > latest.at ? candidate : latest));
}

const CHECK_RUN_FAILURES = new Set([
	"FAILURE",
	"TIMED_OUT",
	"CANCELLED",
	"ACTION_REQUIRED",
	"STARTUP_FAILURE",
	"STALE",
]);

const CHECK_RUN_SUCCESSES = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/** Collapses the check rollup into the counts the table shows. */
export function summariseChecks(node: PullRequestFactsNode): ChecksSummary {
	const contexts =
		node.commits?.nodes?.[0]?.commit.statusCheckRollup?.contexts.nodes ?? ([] as null[]);

	let passed = 0;
	let failed = 0;
	let pending = 0;

	for (const context of contexts) {
		switch (classifyContext(context)) {
			case "passed": {
				passed += 1;
				break;
			}
			case "failed": {
				failed += 1;
				break;
			}
			case "pending": {
				pending += 1;
				break;
			}
			default: {
				break;
			}
		}
	}

	const state = failed > 0 ? "failing" : pending > 0 ? "pending" : passed > 0 ? "passing" : "none";
	return { state, passed, failed, pending };
}

function classifyContext(
	context: CheckContextNode | null,
): "passed" | "failed" | "pending" | "unknown" {
	if (!context) {
		return "unknown";
	}

	if (context.__typename === "CheckRun") {
		if (context.status !== "COMPLETED") {
			return "pending";
		}
		const conclusion = context.conclusion ?? "";
		if (CHECK_RUN_SUCCESSES.has(conclusion)) {
			return "passed";
		}
		return CHECK_RUN_FAILURES.has(conclusion) ? "failed" : "unknown";
	}

	switch (context.state) {
		case "SUCCESS": {
			return "passed";
		}
		case "FAILURE":
		case "ERROR": {
			return "failed";
		}
		case "PENDING":
		case "EXPECTED": {
			return "pending";
		}
		default: {
			return "unknown";
		}
	}
}

/**
 * Turns one GraphQL issue node into the facts the rest of the app works with.
 *
 * `changedAt` is the point of this function. An issue's `updatedAt` moves for a label, an assignee,
 * a milestone or a reaction, none of which can change a judgment, so triaging against it would
 * leave every issue permanently due and the bill permanently running. What counts instead is the
 * body being edited, a human commenting, or the issue being reopened.
 */
export function toIssueFacts(node: IssueFactsNode, options: MapOptions): IssueFacts {
	const author = node.author?.login ?? "ghost";
	const comments = (node.comments?.nodes ?? []).filter((comment) => comment !== null);
	const humanComments = comments.filter((comment) => !isBot(comment.author));
	const timeline = (node.timelineItems?.nodes ?? []).filter((entry) => entry !== null);

	const judgeable = [node.createdAt, node.lastEditedAt];
	for (const comment of humanComments) {
		judgeable.push(comment.createdAt);
	}
	for (const entry of timeline) {
		if (entry.__typename === "ReopenedEvent" && entry.createdAt) {
			judgeable.push(entry.createdAt);
		}
	}

	// Activity, unlike change, counts anyone: a bot's comment is still something happening.
	const activity: { at: string; by: string | null }[] = [{ at: node.createdAt, by: author }];
	for (const comment of comments) {
		activity.push({ at: comment.createdAt, by: comment.author?.login ?? null });
	}
	const latestActivity = activity.reduce((newest, candidate) =>
		candidate.at > newest.at ? candidate : newest,
	);

	return {
		repository: options.repository,
		kind: "issue",
		number: node.number,
		title: node.title,
		url: node.url,
		author,
		isBot: isBot(node.author),
		authorAssociation: node.authorAssociation,
		authoredByUser: author === options.viewerLogin,
		createdAt: node.createdAt,
		updatedAt: node.updatedAt,
		changedAt: newestOf(judgeable),
		labels: (node.labels?.nodes ?? []).map((label) => label.name),
		lastActivityBy: latestActivity.by,
		lastActivityAt: latestActivity.at,
		assignees: (node.assignees?.nodes ?? [])
			.filter((assignee) => assignee !== null)
			.map((assignee) => assignee.login),
		milestone: node.milestone?.title ?? null,
		comments: node.comments?.totalCount ?? 0,
		linkedPullRequests: timeline
			.filter((entry) => entry.__typename === "CrossReferencedEvent")
			.map((entry) => entry.source)
			.filter((source) => source?.__typename === "PullRequest" && source.number !== undefined)
			.map((source) => source?.number)
			.filter((number): number is number => number !== undefined),
		stateReason: node.stateReason,
	};
}

/** The newest of some timestamps, ignoring the ones GitHub left null. */
function newestOf(candidates: (string | null | undefined)[]): string {
	const known = candidates.filter((candidate): candidate is string => Boolean(candidate));
	return known.reduce((newest, candidate) => (candidate > newest ? candidate : newest));
}
