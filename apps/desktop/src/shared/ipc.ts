import type {
	AgentCatalog,
	AgentKind,
	Analysis,
	Assessment,
	Config,
	DerivedFields,
	EffortLevel,
	Job,
	Note,
	Refresh,
	RefreshCandidate,
	ReviewDraft,
	Snooze,
	StoredPullRequest,
	Viewed,
} from "@proctologist/core/browser";

export type {
	AgentCatalog,
	AgentEffortLevel,
	AgentKind,
	AgentModel,
	Analysis,
	Assessment,
	Config,
	EffortLevel,
	Job,
	OutdatedReason,
	ProfileName,
	Refresh,
	RefreshCandidate,
	ReviewDraft,
} from "@proctologist/core/browser";

/** Where a pull request stands with the agent: waiting its turn, or in its hands right now. */
export type AssessingState = "queued" | "running";

/** What the agent is doing, or about to do, with one pull request. */
export interface RowActivity {
	/** A thorough assessment reads the same as a quick one to the row. */
	kind: "assessment" | "review_draft";
	state: AssessingState;
}

/** One row of the main table, with everything the renderer needs to show and filter it. */
export interface PullRequestRow {
	pullRequest: StoredPullRequest;
	assessment: Assessment | null;
	previousAssessment: Assessment | null;
	note: Note | null;
	snooze: Snooze | null;
	viewed: Viewed | null;
	derived: DerivedFields;
	/** Set while a job is about to work on this pull request, or is working on it. */
	activity: RowActivity | null;
	/** True once a thorough assessment has written an analysis, even one a quick one has replaced. */
	hasAnalysis: boolean;
}

export interface RepositorySummary {
	name: string;
	owner: string;
	repo: string;
	clone: string | null;
	open: number;
	/** How many the last refresh left due for a quick assessment. */
	due: number;
	lastRefresh: Refresh | null;
}

export interface PullRequestDetail extends PullRequestRow {
	history: Assessment[];
	/**
	 * The newest analysis, from whichever thorough assessment wrote it: a quick assessment may have
	 * replaced that one since, and the analysis is still worth reading.
	 */
	analysis: Analysis | null;
	reviewDraft: ReviewDraft | null;
	reviewDraftMarkdown: string | null;
}

export interface ListPullRequestsQuery {
	repository: string;
	includeClosed?: boolean;
}

export interface SnoozeCommand {
	repository: string;
	number: number;
	/** A date to snooze until; without one the snooze lasts until the assessment is replaced. */
	until?: string;
}

export interface NoteCommand {
	repository: string;
	number: number;
	text: string;
}

export interface ReviewCommand {
	repository: string;
	number: number;
	effort?: EffortLevel;
}

/** What each installed agent says it can do, keyed by agent. */
export type AgentCatalogs = Record<AgentKind, AgentCatalog>;

/** How the window is tinted. "system" follows the operating system, and is the default. */
export const APPEARANCE_MODES = ["system", "light", "dark"] as const;

export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

export interface RemoteCheck {
	ok: boolean;
	/** The remote whose URL points at the repository, when one does. */
	remote: string | null;
	message: string | null;
}

/** The command line argument the main process hands the preload script the system locale in. */
export const SYSTEM_LOCALE_ARGUMENT = "--proctologist-system-locale=";

export interface ProctologistApi {
	/**
	 * The locale of the operating system's regional settings, for formatting dates, times and
	 * numbers. Chromium's own default follows the interface language instead, which on a Mac set
	 * to English with a European region shows a 12-hour clock the user never asked for.
	 */
	locale: string;
	getConfig: () => Promise<Config>;
	writeConfig: (config: Config) => Promise<void>;
	listRepositories: () => Promise<RepositorySummary[]>;
	listPullRequests: (query: ListPullRequestsQuery) => Promise<PullRequestRow[]>;
	getPullRequest: (query: { repository: string; number: number }) => Promise<PullRequestDetail>;
	/** Every job of this session, newest first: what the app is doing and what it has done. */
	listJobs: () => Promise<Job[]>;
	/** Fetches the open pull requests. Assesses nothing. */
	refresh: (query: { repository: string }) => Promise<Job>;
	refreshAll: () => Promise<Job[]>;
	/**
	 * Assesses what the last refresh left due, or with `full` every open pull request. Null when
	 * there is nothing to assess, or the user chose none.
	 */
	assessDue: (query: { repository: string; full?: boolean }) => Promise<Job | null>;
	/** Answers a `confirm-assessments` question. `numbers: null` assesses nothing. */
	answerAssessments: (answer: { requestId: string; numbers: number[] | null }) => Promise<void>;
	abort: (query: { id: string }) => Promise<boolean>;
	assessQuick: (query: { repository: string; number: number }) => Promise<Job>;
	assessThorough: (query: { repository: string; number: number }) => Promise<Job>;
	draftReview: (command: ReviewCommand) => Promise<Job>;
	snooze: (command: SnoozeCommand) => Promise<void>;
	unsnooze: (query: { repository: string; number: number }) => Promise<void>;
	/** Records that the user saw the pull request as it stands. */
	markViewed: (query: { repository: string; number: number }) => Promise<void>;
	clearViewed: (query: { repository: string; number: number }) => Promise<void>;
	setNote: (command: NoteCommand) => Promise<void>;
	openOnGitHub: (query: { url: string }) => Promise<void>;
	/** Goes through the main process because the renderer is not a secure context. */
	copyToClipboard: (query: { text: string }) => Promise<void>;
	/** Opens a folder picker; null when the user cancels. */
	chooseCloneFolder: () => Promise<string | null>;
	/** Says whether the clone has a remote pointing at the repository (ADR 0001). */
	checkRemote: (query: { repository: string; clone: string }) => Promise<RemoteCheck>;
	/** Which models and effort levels each installed agent accepts. */
	listAgentCatalogs: () => Promise<AgentCatalogs>;
	/** Launching at login is an operating system setting, not part of the config file. */
	getLaunchAtLogin: () => Promise<boolean>;
	setLaunchAtLogin: (query: { enabled: boolean }) => Promise<void>;
	/**
	 * Tells the main process which appearance the user picked, so the native menus, dialogs and
	 * window chrome match the window. The renderer remembers the choice itself.
	 */
	setAppearance: (query: { mode: AppearanceMode }) => Promise<void>;
	/** Subscribes to a channel; returns a function that stops listening. */
	on: <K extends keyof ProctologistEvents>(
		channel: K,
		listener: (payload: ProctologistEvents[K]) => void,
	) => () => void;
}

export interface AssessmentQuestion {
	requestId: string;
	repository: string;
	candidates: RefreshCandidate[];
}

export interface ProctologistEvents {
	"job-changed": Job;
	/** More is due than the threshold, and assessing waits for an answer. */
	"confirm-assessments": AssessmentQuestion;
	/** Something in the database changed and views of this repository should be re-read. */
	"data-changed": { repository: string | null };
	"config-changed": Config;
}

export const IPC_CHANNELS = [
	"getConfig",
	"writeConfig",
	"listRepositories",
	"listPullRequests",
	"getPullRequest",
	"listJobs",
	"refresh",
	"refreshAll",
	"assessDue",
	"answerAssessments",
	"abort",
	"assessQuick",
	"assessThorough",
	"draftReview",
	"snooze",
	"unsnooze",
	"markViewed",
	"clearViewed",
	"setNote",
	"openOnGitHub",
	"copyToClipboard",
	"chooseCloneFolder",
	"checkRemote",
	"listAgentCatalogs",
	"getLaunchAtLogin",
	"setLaunchAtLogin",
	"setAppearance",
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

export const EVENT_CHANNELS = [
	"job-changed",
	"data-changed",
	"config-changed",
	"confirm-assessments",
] as const;

/** Prefix keeps our channels out of the way of anything Electron uses. */
export const CHANNEL_PREFIX = "proctologist:";
