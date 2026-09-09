import { defaultConfig, toMarkdown, type Config, type Job } from "@proctologist/core/browser";
import type {
	ProctologistApi,
	ProctologistEvents,
	PullRequestDetail,
	PullRequestRow,
	RepositorySummary,
} from "../../../shared/ipc.js";
import { row, verdict, REPOSITORY } from "./rows.js";

/**
 * A stand-in bridge for running the renderer in a plain browser during development. It is loaded
 * only when `window.proctologist` is missing and only in a development build.
 */

const NOW = "2026-09-09T12:00:00.000Z";

const ROWS: PullRequestRow[] = [
	row({
		number: 5642,
		title: "[popover] Fix focus restoration when the trigger unmounts",
		verdict: verdict({
			nextAction: "merge",
			effort: "XS",
			status: "ready_to_merge",
			summary: "Restores focus to the document body when a popover trigger unmounts while open.",
			nextActionReason: "Approved, green, and the change is two lines.",
		}),
		reviewRequestedFromUser: true,
		labels: ["bug"],
		lastActivityAt: "2026-09-08T09:12:00.000Z",
	}),
	row({
		number: 5610,
		title: "[select] Add a `multiple` prop",
		verdict: verdict({
			nextAction: "review",
			effort: "M",
			category: "feature",
			summary: "Adds multi-selection to Select, with a new value shape and keyboard handling.",
			nextActionReason: "A sizeable feature nobody has looked at yet.",
		}),
		reviewRequestedFromUser: true,
		lastActivityAt: "2026-09-06T14:00:00.000Z",
	}),
	row({
		number: 5656,
		title: "Bump vitest to 4.1.11 [SECURITY]",
		author: "renovate[bot]",
		isBot: true,
		labels: ["dependencies", "security"],
		verdict: verdict({
			nextAction: "merge",
			effort: "XS",
			category: "dependency_infra",
			status: "ready_to_merge",
			summary: "Routine security bump of vitest with no source changes.",
			nextActionReason: "Checks pass and the lockfile is the only meaningful change.",
		}),
		lastActivityAt: "2026-09-09T08:35:00.000Z",
	}),
	row({
		number: 3063,
		title: "[accordion] Add data-hidden to collapsible panels",
		verdict: verdict({
			nextAction: "nudge_author",
			effort: "S",
			category: "feature",
			status: "waiting_on_author",
			relevance: "still_relevant",
			summary: "Adds data-hidden to Accordion and Collapsible panels for easier styling.",
			nextActionReason: "Review feedback from October is still unanswered and it now conflicts.",
			relevanceReason: "The panel attribute enums on master still lack data-hidden.",
			statusReason: "Outstanding feedback about exit animations, plus conflicts with master.",
			confidence: 0.95,
			evidence: [
				{ note: "useCollapsiblePanel still computes hidden as !open && !mounted" },
				{
					note: "Two rounds of review feedback with no author response",
					url: "https://github.com/owner/thing/pull/3063",
				},
			],
		}),
		previousVerdict: verdict({
			nextAction: "review",
			effort: "S",
			status: "waiting_on_maintainer",
		}),
		createdAt: "2025-10-24T10:00:00.000Z",
		lastActivityAt: "2026-06-14T10:00:00.000Z",
		note: "Worth finishing myself if the author has moved on.",
	}),
	row({
		number: 2528,
		title: "[number field] Export formatNumber utilities",
		verdict: verdict({
			nextAction: "decide",
			effort: "S",
			category: "feature",
			status: "blocked_on_discussion",
			relevance: "unclear",
			summary: "Exports the internal number formatting helpers as public API.",
			nextActionReason: "Whether these become public API is a call only a maintainer can make.",
		}),
		createdAt: "2025-08-17T10:00:00.000Z",
		lastActivityAt: "2026-02-02T10:00:00.000Z",
	}),
	row({
		number: 1314,
		title: "[test] Use vitest's userEvent implementation in browser tests",
		authoredByUser: true,
		isDraft: true,
		verdict: verdict({
			nextAction: "continue",
			effort: "L",
			category: "test",
			status: "waiting_on_author",
			summary: "Switches browser tests to vitest's userEvent implementation.",
			nextActionReason: "Your own draft; conflicts and failing checks need sorting first.",
		}),
		createdAt: "2025-01-09T10:00:00.000Z",
		lastActivityAt: "2026-03-01T10:00:00.000Z",
	}),
	row({
		number: 4820,
		title: "[experiments] Shared benchmark harness",
		verdict: verdict({
			nextAction: "close",
			effort: "XS",
			category: "experiment",
			status: "stalled",
			relevance: "likely_obsolete",
			summary: "An experiment superseded by the benchmark harness merged in March.",
			nextActionReason: "The harness it proposes already exists on master.",
			relevanceReason: "packages/bench now contains an equivalent harness.",
		}),
		createdAt: "2025-11-27T10:00:00.000Z",
		lastActivityAt: "2026-01-11T10:00:00.000Z",
	}),
	row({
		number: 5501,
		title: "[navigation menu] Open on hover during hydration",
		isDraft: true,
		verdict: verdict({
			nextAction: "wait",
			effort: "M",
			status: "waiting_on_author",
			summary: "Opens the navigation menu on hover before hydration completes.",
			nextActionReason: "Still a draft with checks running.",
		}),
		lastActivityAt: "2026-09-07T10:00:00.000Z",
	}),
	row({ number: 5333, error: "Codex did not finish within 3 minutes." }),
	row({
		number: 5120,
		title: "[menu] Add a pressMode option to MenuTrigger",
		snoozedUntil: "2026-12-01T00:00:00.000Z",
		verdict: verdict({ nextAction: "review", effort: "M" }),
	}),
	row({
		number: 5001,
		title: "[docs] Fix a broken anchor",
		closedAt: "2026-09-05T12:00:00.000Z",
		verdict: verdict({ nextAction: "merge", effort: "XS" }),
	}),
];

const CONFIG: Config = {
	...defaultConfig,
	repositories: [
		{
			name: REPOSITORY,
			owner: "owner",
			repo: "thing",
			clone: "/Users/you/Projects/thing",
			codexProfiles: {},
		},
	],
};

export function createMockApi(): ProctologistApi {
	const listeners = new Map<string, Set<(payload: never) => void>>();

	const emit = <K extends keyof ProctologistEvents>(
		channel: K,
		payload: ProctologistEvents[K],
	): void => {
		for (const listener of listeners.get(channel) ?? []) {
			(listener as (value: ProctologistEvents[K]) => void)(payload);
		}
	};

	const job = (overrides: Partial<Job> = {}): Job => ({
		id: "mock-job",
		kind: "refresh",
		repository: REPOSITORY,
		itemKind: null,
		number: null,
		state: "completed",
		progress: null,
		error: null,
		createdAt: NOW,
		startedAt: NOW,
		finishedAt: NOW,
		...overrides,
	});

	const summary: RepositorySummary = {
		name: REPOSITORY,
		owner: "owner",
		repo: "thing",
		clone: "/Users/you/Projects/thing",
		open: ROWS.filter((item) => item.pullRequest.closedAt === null).length,
		quickWins: ROWS.filter((item) => item.derived.quickWin).length,
		unassessed: ROWS.filter((item) => item.derived.unassessed).length,
		lastRefresh: {
			id: 1,
			repository: REPOSITORY,
			startedAt: "2026-09-09T08:00:00.000Z",
			finishedAt: "2026-09-09T08:04:00.000Z",
			outcome: "completed",
			error: null,
			counts: { fetched: 11, added: 2, changed: 3, reassessed: 3, unassessed: 1, closed: 1 },
		},
		runningJob: null,
	};

	return {
		getConfig: () => Promise.resolve(CONFIG),
		writeConfig: () => Promise.resolve(),
		listRepositories: () => Promise.resolve([summary]),
		listPullRequests: ({ includeClosed }) =>
			Promise.resolve(ROWS.filter((item) => includeClosed || item.pullRequest.closedAt === null)),
		getPullRequest: ({ number }) => {
			const found = ROWS.find((item) => item.pullRequest.number === number);
			if (!found) {
				return Promise.reject(new Error(`No pull request ${String(number)}`));
			}
			const draft =
				number === 5610
					? {
							id: 1,
							repository: REPOSITORY,
							kind: "pull_request" as const,
							number,
							headSha: found.pullRequest.headSha,
							summary: "Solid, but the value shape needs a second look.",
							verdict: "request_changes",
							findings: [
								{
									title: "Value type widens silently",
									body: "`value` becomes `string | string[]` with no discriminator.",
									severity: "major",
									path: "packages/react/src/select/root/SelectRoot.tsx",
									line: 88,
								},
							],
							sessionId: "mock-session",
							model: null,
							createdAt: NOW,
						}
					: null;

			const detail: PullRequestDetail = {
				...found,
				history: found.previousAssessment
					? [found.assessment, found.previousAssessment].filter((item) => item !== null)
					: found.assessment
						? [found.assessment]
						: [],
				reviewDraft: draft,
				reviewDraftMarkdown: draft ? toMarkdown(draft) : null,
			};
			return Promise.resolve(detail);
		},
		listJobs: () => Promise.resolve([job()]),
		refresh: () => {
			const running = job({ state: "running", progress: { done: 2, total: 6 } });
			emit("job-changed", running);
			setTimeout(() => {
				emit("job-changed", job());
				emit("data-changed", { repository: REPOSITORY });
			}, 1500);
			return Promise.resolve(running);
		},
		refreshAll: () => Promise.resolve([job()]),
		abort: () => Promise.resolve(true),
		assessQuick: () => Promise.resolve(),
		assessThorough: () => Promise.resolve(job({ kind: "thorough_assessment", number: 1 })),
		draftReview: () => Promise.resolve(job({ kind: "review_draft", number: 1 })),
		snooze: () => Promise.resolve(),
		unsnooze: () => Promise.resolve(),
		setNote: () => Promise.resolve(),
		copyToClipboard: ({ text }) => globalThis.navigator.clipboard.writeText(text),
		chooseCloneFolder: () => Promise.resolve("/Users/you/Projects/thing"),
		checkRemote: ({ clone }) =>
			Promise.resolve(
				clone.includes("thing")
					? { ok: true, remote: "upstream", message: null }
					: { ok: false, remote: null, message: "No remote here points at owner/thing." },
			),
		openOnGitHub: ({ url }) => {
			globalThis.open(url, "_blank");
			return Promise.resolve();
		},
		on: (channel, listener) => {
			const set = listeners.get(channel) ?? new Set();
			set.add(listener as (payload: never) => void);
			listeners.set(channel, set);
			return () => set.delete(listener as (payload: never) => void);
		},
	};
}
