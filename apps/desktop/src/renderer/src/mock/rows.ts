import {
	derive,
	type AssessmentVerdict,
	type StoredIssue,
	type StoredPullRequest,
} from "@proctologist/core/browser";
import type { ItemRow, RowActivity } from "../../../shared/ipc.js";

/**
 * Row builders shared by the unit tests and the development fallback bridge, so both work against
 * the same shapes the real IPC surface returns.
 */

export const REPOSITORY = "owner/thing";

export function verdict(overrides: Partial<AssessmentVerdict> = {}): AssessmentVerdict {
	return {
		nextAction: "review",
		nextActionReason: "Nobody has looked at it yet.",
		area: "bug_fix",
		relevance: "still_relevant",
		relevanceReason: "The code it patches is still on the default branch.",
		status: "waiting_on_maintainer",
		statusReason: "Checks pass and no review has been left.",
		effort: "S",
		effortReason: "Two small files.",
		priority: "medium",
		priorityReason: "Nobody is blocked; the bug has a workaround.",
		summary: "Fixes an off-by-one in the panel height calculation.",
		confidence: 0.8,
		evidence: [{ note: "src/panel.ts still contains the loop this patches", url: undefined }],
		type: null,
		possibleDuplicateOf: [],
		...overrides,
	};
}

export interface RowOptions {
	number: number;
	title?: string;
	author?: string;
	verdict?: AssessmentVerdict | null;
	previousVerdict?: AssessmentVerdict;
	isDraft?: boolean;
	isBot?: boolean;
	authorAssociation?: string;
	authoredByUser?: boolean;
	reviewRequestedFromUser?: boolean;
	labels?: string[];
	createdAt?: string;
	lastActivityAt?: string;
	closedAt?: string | null;
	note?: string;
	snoozedUntil?: string;
	error?: string;
	depth?: "quick" | "thorough";
	/** A thorough assessment has left an analysis behind, whatever the current depth. */
	hasAnalysis?: boolean;
	activity?: RowActivity;
	now?: string;
}

const NOW = "2026-09-09T12:00:00.000Z";

export function row(options: RowOptions): ItemRow {
	const now = options.now ?? NOW;
	const item: StoredPullRequest = {
		repository: REPOSITORY,
		kind: "pull_request",
		number: options.number,
		title: options.title ?? `Pull request ${String(options.number)}`,
		url: `https://github.com/${REPOSITORY}/pull/${String(options.number)}`,
		author: options.author ?? "contributor",
		isBot: options.isBot ?? false,
		authorAssociation: options.authorAssociation ?? "CONTRIBUTOR",
		authoredByUser: options.authoredByUser ?? false,
		reviewRequestedFromUser: options.reviewRequestedFromUser ?? false,
		createdAt: options.createdAt ?? "2026-06-01T12:00:00.000Z",
		updatedAt: "2026-09-01T12:00:00.000Z",
		changedAt: "2026-09-01T12:00:00.000Z",
		isDraft: options.isDraft ?? false,
		labels: options.labels ?? [],
		headSha: `sha-${String(options.number)}`,
		baseRef: "master",
		additions: 24,
		deletions: 6,
		changedFiles: 2,
		mergeable: "MERGEABLE",
		reviewDecision: null,
		checks: { state: "passing", passed: 12, failed: 0, pending: 0 },
		lastActivityBy: options.author ?? "contributor",
		lastActivityAt: options.lastActivityAt ?? "2026-09-01T12:00:00.000Z",
		closedAt: options.closedAt ?? null,
		fetchedAt: now,
	};

	const current =
		options.verdict === null
			? null
			: {
					id: options.number * 10,
					repository: REPOSITORY,
					kind: "pull_request" as const,
					number: options.number,
					depth: options.depth ?? ("quick" as const),
					headSha: item.headSha,
					updatedAtSeen: item.updatedAt,
					verdict: options.verdict ?? verdict(),
					error: null,
					agent: "codex" as const,
					model: null,
					durationMs: 21_000,
					createdAt: "2026-09-08T09:00:00.000Z",
				};

	const unassessed =
		options.error === undefined
			? null
			: {
					id: options.number * 10,
					repository: REPOSITORY,
					kind: "pull_request" as const,
					number: options.number,
					depth: "quick" as const,
					headSha: item.headSha,
					updatedAtSeen: item.updatedAt,
					verdict: null,
					error: options.error,
					agent: "codex" as const,
					model: null,
					durationMs: 180_000,
					createdAt: "2026-09-08T09:00:00.000Z",
				};

	const assessment = unassessed ?? current;
	const previousAssessment =
		options.previousVerdict && assessment
			? { ...assessment, id: assessment.id - 1, verdict: options.previousVerdict }
			: undefined;

	const note =
		options.note === undefined
			? undefined
			: {
					repository: REPOSITORY,
					kind: "pull_request" as const,
					number: options.number,
					text: options.note,
					updatedAt: now,
				};

	const snooze =
		options.snoozedUntil === undefined
			? undefined
			: {
					repository: REPOSITORY,
					kind: "pull_request" as const,
					number: options.number,
					untilAssessmentId: null,
					untilDate: options.snoozedUntil,
					createdAt: now,
				};

	return {
		item,
		assessment: assessment ?? null,
		previousAssessment: previousAssessment ?? null,
		note: note ?? null,
		snooze: snooze ?? null,
		activity: options.activity ?? null,
		hasAnalysis: options.hasAnalysis ?? false,
		derived: derive(
			{
				item,
				assessment: assessment ?? undefined,
				previousAssessment,
				hasNote: note !== undefined,
				snooze,
			},
			now,
		),
	};
}

/** A handful of issues, so the Issues destination has something to look at in the browser view. */
export function issueRows(): ItemRow[] {
	const make = (
		number: number,
		title: string,
		overrides: Partial<AssessmentVerdict> & { comments?: number; assignees?: string[] },
	): ItemRow => {
		const { comments = 0, assignees = [], ...judged } = overrides;
		const base = row({ number, title });
		const item: StoredIssue = {
			repository: REPOSITORY,
			kind: "issue",
			number,
			title,
			url: `https://github.com/${REPOSITORY}/issues/${String(number)}`,
			author: base.item.author,
			isBot: false,
			authorAssociation: number % 3 === 0 ? "FIRST_TIME_CONTRIBUTOR" : "NONE",
			authoredByUser: false,
			createdAt: base.item.createdAt,
			updatedAt: base.item.updatedAt,
			changedAt: base.item.updatedAt,
			labels: ["bug"],
			lastActivityBy: base.item.lastActivityBy,
			lastActivityAt: base.item.lastActivityAt,
			assignees,
			milestone: null,
			comments,
			linkedPullRequests: number === 812 ? [5656] : [],
			stateReason: null,
			closedAt: null,
			fetchedAt: base.item.fetchedAt,
		};
		return {
			...base,
			item,
			assessment: base.assessment
				? { ...base.assessment, kind: "issue", verdict: { ...verdict(), ...judged } }
				: null,
		};
	};

	return [
		make(944, "Crash when the config has no repositories", {
			nextAction: "fix",
			type: "bug",
			effort: "S",
			priority: "critical",
			summary: "Reproduced twice; the fix is a guard.",
			comments: 12,
		}),
		make(931, "How do I point it at a fork?", {
			nextAction: "answer",
			type: "question",
			effort: "XS",
			priority: "low",
			summary: "A pointer to the readme settles it.",
			comments: 2,
		}),
		make(902, "Support GitLab as well", {
			nextAction: "decide",
			type: "feature_request",
			effort: "XL",
			priority: "medium",
			summary: "A whole second forge; needs a call on scope.",
			comments: 31,
		}),
		make(880, "Cannot reproduce the slow refresh", {
			nextAction: "request_info",
			type: "bug",
			relevance: "unclear",
			effort: "M",
			priority: "medium",
			summary: "No version, no repository size, no timings.",
			comments: 5,
		}),
		make(812, "Dark mode contrast on the effort badge", {
			nextAction: "fix",
			type: "bug",
			effort: "XS",
			priority: "low",
			summary: "A token swap; a pull request already points at it.",
			comments: 1,
			assignees: ["maintainer"],
		}),
		make(744, "Document the triage vocabulary", {
			nextAction: "fix",
			type: "documentation",
			effort: "S",
			priority: "low",
			summary: "The glossary has it; the readme does not.",
			comments: 0,
		}),
	];
}
