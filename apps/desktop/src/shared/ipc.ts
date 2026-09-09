import type {
	Assessment,
	CodexModel,
	Config,
	DerivedFields,
	Job,
	Note,
	Refresh,
	ReasoningEffort,
	ReviewDraft,
	Snooze,
	StoredPullRequest,
} from "@proctologist/core/browser";

export type {
	Assessment,
	CodexModel,
	Config,
	Job,
	ReasoningEffort,
	ReviewDraft,
} from "@proctologist/core/browser";

/** One row of the main table, with everything the renderer needs to show and filter it. */
export interface PullRequestRow {
	pullRequest: StoredPullRequest;
	assessment: Assessment | null;
	previousAssessment: Assessment | null;
	note: Note | null;
	snooze: Snooze | null;
	derived: DerivedFields;
}

export interface RepositorySummary {
	name: string;
	owner: string;
	repo: string;
	clone: string | null;
	open: number;
	quickWins: number;
	unassessed: number;
	lastRefresh: Refresh | null;
	/** The refresh job running for this repository, if any. */
	runningJob: Job | null;
}

export interface PullRequestDetail extends PullRequestRow {
	history: Assessment[];
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
	effort?: ReasoningEffort;
}

/** What the renderer can ask the main process to do. Every call is `invoke`-shaped. */
export interface CodexCatalog {
	models: CodexModel[];
	/** Why the catalog could not be read, when it could not. */
	error: string | null;
}

export interface RemoteCheck {
	ok: boolean;
	/** The remote whose URL points at the repository, when one does. */
	remote: string | null;
	message: string | null;
}

export interface ProctologistApi {
	getConfig: () => Promise<Config>;
	writeConfig: (config: Config) => Promise<void>;
	listRepositories: () => Promise<RepositorySummary[]>;
	listPullRequests: (query: ListPullRequestsQuery) => Promise<PullRequestRow[]>;
	getPullRequest: (query: { repository: string; number: number }) => Promise<PullRequestDetail>;
	listJobs: () => Promise<Job[]>;
	refresh: (query: { repository: string; full?: boolean }) => Promise<Job>;
	refreshAll: (query?: { full?: boolean }) => Promise<Job[]>;
	abort: (query: { id: string }) => Promise<boolean>;
	assessQuick: (query: { repository: string; number: number }) => Promise<void>;
	assessThorough: (query: { repository: string; number: number }) => Promise<Job>;
	draftReview: (command: ReviewCommand) => Promise<Job>;
	snooze: (command: SnoozeCommand) => Promise<void>;
	unsnooze: (query: { repository: string; number: number }) => Promise<void>;
	setNote: (command: NoteCommand) => Promise<void>;
	openOnGitHub: (query: { url: string }) => Promise<void>;
	/** Goes through the main process because the renderer is not a secure context. */
	copyToClipboard: (query: { text: string }) => Promise<void>;
	/** Opens a folder picker; null when the user cancels. */
	chooseCloneFolder: () => Promise<string | null>;
	/** Says whether the clone has a remote pointing at the repository (ADR 0001). */
	checkRemote: (query: { repository: string; clone: string }) => Promise<RemoteCheck>;
	/** Which models and reasoning levels the local Codex accepts. */
	listCodexModels: () => Promise<CodexCatalog>;
	/** Launching at login is an operating system setting, not part of the config file. */
	getLaunchAtLogin: () => Promise<boolean>;
	setLaunchAtLogin: (query: { enabled: boolean }) => Promise<void>;
	/** Subscribes to a channel; returns a function that stops listening. */
	on: <K extends keyof ProctologistEvents>(
		channel: K,
		listener: (payload: ProctologistEvents[K]) => void,
	) => () => void;
}

export interface ProctologistEvents {
	"job-changed": Job;
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
	"abort",
	"assessQuick",
	"assessThorough",
	"draftReview",
	"snooze",
	"unsnooze",
	"setNote",
	"openOnGitHub",
	"copyToClipboard",
	"chooseCloneFolder",
	"checkRemote",
	"getLaunchAtLogin",
	"setLaunchAtLogin",
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

export const EVENT_CHANNELS = ["job-changed", "data-changed", "config-changed"] as const;

/** Prefix keeps our channels out of the way of anything Electron uses. */
export const CHANNEL_PREFIX = "proctologist:";
