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

const ISSUE_STATUSES_BY_INDEX = [
	"accepted",
	"needs_reproduction",
	"awaiting_reporter",
	"blocked_on_discussion",
	"stalled",
];

const TITLES = [
	"Tooltip stays open after the trigger unmounts",
	"Select does not restore focus on Escape",
	"Combobox drops the first keystroke",
	"Dialog scroll lock leaks on iOS",
	"Menu arrow keys skip disabled items",
	"Popover flickers when it flips",
	"Slider thumb jumps on touch",
	"Tabs indicator lags behind the active tab",
];

/** A handful of issues, so the Issues destination has something to look at in the browser view. */
export function issueRows(): ItemRow[] {
	const make = (
		number: number,
		title: string,
		overrides: Partial<AssessmentVerdict> & {
			comments?: number;
			assignees?: string[];
			votesUp?: number;
			votesDown?: number;
		},
	): ItemRow => {
		const { comments = 0, assignees = [], votesUp = 0, votesDown = 0, ...judged } = overrides;
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
			upvotes: votesUp,
			downvotes: votesDown,
			linkedPullRequests: number === 812 ? [5656] : [],
			stateReason: null,
			closedAt: null,
			fetchedAt: base.item.fetchedAt,
		};
		return {
			...base,
			item,
			assessment: base.assessment
				? {
						...base.assessment,
						kind: "issue",
						// An issue's statuses are its own; a pull request's are all about merging.
						verdict: {
							...verdict(),
							status:
								ISSUE_STATUSES_BY_INDEX[number % ISSUE_STATUSES_BY_INDEX.length] ?? "accepted",
							statusReason: "Where the thread has got to.",
							...judged,
						},
					}
				: null,
		};
	};

	// A real backlog, so the browser view shows what a thousand rows actually feel like.
	const filler = Array.from({ length: 420 }, (_, index) => {
		const number = 700 - index;
		const areas = ["bug", "feature_request", "question", "documentation", "discussion"] as const;
		const actions = [
			"fix",
			"answer",
			"reproduce",
			"request_info",
			"decide",
			"close",
			"wait",
		] as const;
		const efforts = ["XS", "S", "M", "L", "XL"] as const;
		return make(number, `${TITLES[index % TITLES.length]} (#${String(number)})`, {
			nextAction: actions[index % actions.length],
			area: areas[(index * 3) % areas.length],
			effort: efforts[(index * 7) % efforts.length],
			priority: (["critical", "high", "medium", "low"] as const)[(index * 5) % 4],
			summary: "Filler, so the list is long enough to be worth windowing.",
			comments: (index * 13) % 47,
			votesUp: (index * 17) % 40,
			votesDown: index % 11 === 0 ? (index * 3) % 7 : 0,
		});
	});

	return [
		...filler,
		make(944, "Crash when the config has no repositories", {
			nextAction: "fix",
			effort: "S",
			priority: "critical",
			summary: "Reproduced twice; the fix is a guard.",
			comments: 12,
			votesUp: 9,
		}),
		make(938, "Crash when config has no repositories", {
			nextAction: "close_duplicate",
			area: "bug",
			// Judged XL: the change asked for is large, and none of it is going to happen.
			effort: "XL",
			priority: "medium",
			summary: "The same crash as #944, reported a day later.",
			confidence: 0.85,
			possibleDuplicateOf: [944],
			comments: 3,
		}),
		make(931, "How do I point it at a fork?", {
			nextAction: "answer",
			area: "question",
			effort: "XS",
			priority: "low",
			summary: "A pointer to the readme settles it.",
			comments: 2,
		}),
		make(902, "Support GitLab as well", {
			nextAction: "decide",
			area: "feature_request",
			effort: "XL",
			priority: "medium",
			summary: "A whole second forge; needs a call on scope.",
			comments: 31,
			votesUp: 87,
			votesDown: 12,
		}),
		make(880, "Cannot reproduce the slow refresh", {
			nextAction: "request_info",
			relevance: "unclear",
			effort: "M",
			priority: "medium",
			summary: "No version, no repository size, no timings.",
			comments: 5,
		}),
		make(812, "Dark mode contrast on the effort badge", {
			nextAction: "fix",
			effort: "XS",
			priority: "low",
			summary: "A token swap; a pull request already points at it.",
			comments: 1,
			assignees: ["maintainer"],
		}),
		make(744, "Document the triage vocabulary", {
			nextAction: "fix",
			area: "documentation",
			effort: "S",
			priority: "low",
			summary: "The glossary has it; the readme does not.",
			comments: 0,
			votesUp: 2,
		}),
	];
}
