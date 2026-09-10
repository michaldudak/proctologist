import { defaultConfig, toMarkdown, type Config, type Job } from "@proctologist/core/browser";
import type {
	ProctologistApi,
	ProctologistEvents,
	PullRequestDetail,
	PullRequestRow,
	RepositorySummary,
} from "../../../shared/ipc.js";
import { ANALYSIS_MARKDOWN } from "./analysis.js";
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
			priority: "high",
			priorityReason: "Focus is lost for keyboard users on every unmount; the fix is ready.",
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
			area: "feature",
			summary: "Adds multi-selection to Select, with a new value shape and keyboard handling.",
			nextActionReason: "A sizeable feature nobody has looked at yet.",
			priority: "medium",
			priorityReason: "Often requested, but nobody is blocked without it.",
		}),
		reviewRequestedFromUser: true,
		lastActivityAt: "2026-09-06T14:00:00.000Z",
		depth: "thorough",
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
			area: "dependency_infra",
			status: "ready_to_merge",
			summary: "Routine security bump of vitest with no source changes.",
			nextActionReason: "Checks pass and the lockfile is the only meaningful change.",
			priority: "critical",
			priorityReason: "Closes a published advisory in a dependency every consumer installs.",
		}),
		lastActivityAt: "2026-09-09T08:35:00.000Z",
	}),
	row({
		number: 3063,
		title: "[accordion] Add data-hidden to collapsible panels",
		verdict: verdict({
			nextAction: "nudge_author",
			effort: "S",
			area: "feature",
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
			area: "feature",
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
			area: "test",
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
			area: "experiment",
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
	row({
		number: 5333,
		error: "The agent did not finish within 3 minutes.",
		activity: { kind: "assessment", state: "queued" },
	}),
	row({
		number: 5340,
		title: "[dialog] Trap focus inside nested dialogs",
		activity: { kind: "assessment", state: "running" },
	}),
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

/** Kept once written, so the settings dialog reads back what it saved. */
let CONFIG: Config = {
	...defaultConfig,
	repositories: [
		{
			name: REPOSITORY,
			owner: "owner",
			repo: "thing",
			clone: "/Users/you/Projects/thing",
			profiles: {},
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
		parentId: null,
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
		due: 3,
		lastRefresh: {
			id: 1,
			repository: REPOSITORY,
			startedAt: "2026-09-09T08:00:00.000Z",
			finishedAt: "2026-09-09T08:04:00.000Z",
			outcome: "completed",
			error: null,
			errorKind: null,
			counts: { fetched: 11, added: 2, changed: 3, closed: 1, due: 4 },
		},
	};

	return {
		getConfig: () => Promise.resolve(CONFIG),
		writeConfig: (next) => {
			CONFIG = next;
			return Promise.resolve();
		},
		// A second tracked repository, so the views show the header's switcher rather than a plain name.
		listRepositories: () =>
			Promise.resolve([
				summary,
				{
					...summary,
					name: "owner/other-thing",
					repo: "other-thing",
					clone: "/Users/you/Projects/other-thing",
					lastRefresh: null,
				},
			]),
		// Cloned, as the preload bridge would: every answer is a fresh set of objects.
		listPullRequests: ({ includeClosed }) =>
			Promise.resolve(
				structuredClone(ROWS.filter((item) => includeClosed || item.pullRequest.closedAt === null)),
			),
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
							agent: "codex" as const,
							model: null,
							createdAt: NOW,
						}
					: null;

			// The multi-select has a current analysis; the accordion one describes an older head.
			const analysis =
				number === 5610 || number === 3063
					? {
							assessmentId: found.assessment?.id ?? 0,
							repository: REPOSITORY,
							kind: "pull_request" as const,
							number,
							markdown: ANALYSIS_MARKDOWN,
							headSha: number === 5610 ? found.pullRequest.headSha : "sha-older",
							agent: "claude" as const,
							model: "opus",
							createdAt: "2026-09-07T15:30:00.000Z",
						}
					: null;

			const detail: PullRequestDetail = {
				...found,
				history: found.previousAssessment
					? [found.assessment, found.previousAssessment].filter((item) => item !== null)
					: found.assessment
						? [found.assessment]
						: [],
				analysis,
				reviewDraft: draft,
				reviewDraftMarkdown: draft ? toMarkdown(draft) : null,
			};
			return Promise.resolve(detail);
		},
		listJobs: () =>
			Promise.resolve([
				job({
					id: "mock-assessment",
					kind: "assessment",
					parentId: "mock-job",
					state: "aborted",
					progress: { done: 2, total: 4, failed: 1, label: "Assessed 2 of 4" },
					finishedAt: "2026-09-09T08:09:00.000Z",
				}),
				job({
					progress: { done: 1, total: 1, label: "11 open, 2 new, 1 closed, 4 to assess" },
					finishedAt: "2026-09-09T08:04:00.000Z",
				}),
				job({
					id: "mock-review",
					kind: "review_draft",
					number: 5610,
					state: "failed",
					error: "Claude Code did not finish within 30 minutes.",
					createdAt: "2026-09-09T07:00:00.000Z",
					startedAt: "2026-09-09T07:00:00.000Z",
					finishedAt: "2026-09-09T07:30:00.000Z",
				}),
			]),
		// Plays out a refresh: a second of fetching, then the summary.
		refresh: () => {
			const refresh = job({
				id: `refresh-${String(Date.now())}`,
				state: "running",
				progress: { done: 0, total: 1, label: "Fetching pull requests" },
				finishedAt: null,
			});
			emit("job-changed", refresh);
			setTimeout(() => {
				emit("job-changed", {
					...refresh,
					state: "completed",
					finishedAt: NOW,
					progress: { done: 1, total: 1, label: "11 open, 3 to assess" },
				});
				emit("data-changed", { repository: REPOSITORY });
			}, 1000);
			return Promise.resolve(refresh);
		},
		// Plays out a batch of assessments, a step every second or so.
		assessDue: ({ full }) => {
			const total = full ? ROWS.length : 3;
			const assessment = job({
				id: `assessment-${String(Date.now())}`,
				kind: "assessment",
				state: "queued",
				progress: { done: 0, total, failed: 0 },
				startedAt: null,
				finishedAt: null,
			});
			emit("job-changed", assessment);
			let done = 0;
			const tick = (): void => {
				done += 1;
				emit("job-changed", {
					...assessment,
					state: done === total ? "completed" : "running",
					startedAt: NOW,
					finishedAt: done === total ? NOW : null,
					progress: {
						done,
						total,
						failed: 0,
						label: `Assessed ${String(done)} of ${String(total)}`,
					},
				});
				emit("data-changed", { repository: REPOSITORY });
				if (done < total) {
					setTimeout(tick, 1200);
				}
			};
			setTimeout(tick, 1200);
			return Promise.resolve(assessment);
		},
		refreshAll: () => Promise.resolve([job()]),
		answerAssessments: () => Promise.resolve(),
		abort: () => Promise.resolve(true),
		assessQuick: ({ number }) =>
			Promise.resolve(job({ id: "mock-quick", kind: "assessment", number, state: "running" })),
		assessThorough: () => Promise.resolve(job({ kind: "thorough_assessment", number: 1 })),
		draftReview: () => Promise.resolve(job({ kind: "review_draft", number: 1 })),
		snooze: () => Promise.resolve(),
		unsnooze: () => Promise.resolve(),
		// Kept and announced, so the panel goes through the same reload the real bridge causes.
		setNote: ({ number, text }) => {
			const found = ROWS.find((item) => item.pullRequest.number === number);
			if (found) {
				found.note =
					text === ""
						? null
						: { repository: REPOSITORY, kind: "pull_request", number, text, updatedAt: NOW };
				emit("data-changed", { repository: REPOSITORY });
			}
			return Promise.resolve();
		},
		copyToClipboard: ({ text }) => globalThis.navigator.clipboard.writeText(text),
		listAgentCatalogs: () =>
			Promise.resolve({
				codex: {
					agent: "codex" as const,
					openModels: false,
					efforts: [],
					error: null,
					models: [
						{
							slug: "gpt-6-astra",
							displayName: "GPT-6-Astra",
							description: "Our most capable model for complex, demanding work.",
							defaultEffort: "medium",
							efforts: [
								{ effort: "low", description: "Fast responses with lighter reasoning" },
								{ effort: "medium", description: "Balances speed and reasoning depth" },
								{ effort: "high", description: "Greater reasoning depth" },
								{ effort: "xhigh", description: "Extra high reasoning depth" },
								{ effort: "max", description: "Maximum reasoning depth" },
							],
							listed: true,
						},
						{
							slug: "gpt-5.5",
							displayName: "GPT-5.5",
							description: "",
							defaultEffort: "medium",
							efforts: [
								{ effort: "low", description: "" },
								{ effort: "medium", description: "" },
								{ effort: "high", description: "" },
							],
							listed: true,
						},
					],
				},
				claude: {
					agent: "claude" as const,
					openModels: false,
					efforts: [
						{ effort: "low", description: "" },
						{ effort: "medium", description: "" },
						{ effort: "high", description: "" },
						{ effort: "xhigh", description: "" },
						{ effort: "max", description: "" },
					],
					error: null,
					models: [
						{
							slug: "sonnet",
							displayName: "Sonnet (latest)",
							description: "Currently Sonnet 5.",
							defaultEffort: "high",
							efforts: [
								{ effort: "low", description: "" },
								{ effort: "medium", description: "" },
								{ effort: "high", description: "" },
								{ effort: "xhigh", description: "Extra" },
								{ effort: "max", description: "" },
							],
							listed: true,
						},
						{
							slug: "opus",
							displayName: "Opus (latest)",
							description: "Currently Opus 5.",
							defaultEffort: "high",
							efforts: [
								{ effort: "low", description: "" },
								{ effort: "medium", description: "" },
								{ effort: "high", description: "" },
								{ effort: "xhigh", description: "Extra" },
								{ effort: "max", description: "" },
							],
							listed: true,
						},
						{
							slug: "claude-sonnet-5",
							displayName: "Sonnet 5",
							description: "Everyday work at speed",
							defaultEffort: "high",
							efforts: [
								{ effort: "low", description: "" },
								{ effort: "medium", description: "" },
								{ effort: "high", description: "" },
								{ effort: "xhigh", description: "Extra" },
								{ effort: "max", description: "" },
							],
							listed: true,
						},
						{
							slug: "claude-haiku-4-5-20251001",
							displayName: "Haiku 4.5",
							description: "Fastest, for simple tasks",
							defaultEffort: "medium",
							efforts: [],
							listed: true,
						},
					],
				},
			}),
		chooseCloneFolder: () => Promise.resolve("/Users/you/Projects/thing"),
		getLaunchAtLogin: () => Promise.resolve(false),
		setLaunchAtLogin: () => Promise.resolve(),
		setAppearance: () => Promise.resolve(),
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
