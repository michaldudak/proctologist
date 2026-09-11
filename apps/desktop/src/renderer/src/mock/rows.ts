import { derive, type AssessmentVerdict, type StoredPullRequest } from "@proctologist/core/browser";
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
