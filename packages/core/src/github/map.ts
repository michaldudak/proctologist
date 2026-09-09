import type { ChecksSummary, PullRequestFacts } from "../store/types.js";
import type { CheckContextNode, GraphQlActor, PullRequestFactsNode } from "./schema.js";

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
		authoredByUser: author === options.viewerLogin,
		reviewRequestedFromUser: reviewRequestedFrom(node, options.viewerLogin),
		createdAt: node.createdAt,
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
