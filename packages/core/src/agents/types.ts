/**
 * The vocabulary shared by every coding agent the app can drive. Nothing here knows how a
 * particular CLI is spawned; that lives in one dialect module per agent.
 */

/** The coding agent CLIs the app can drive. */
export const AGENT_KINDS = ["codex", "claude"] as const;

export type AgentKind = (typeof AGENT_KINDS)[number];

/** What each agent is called on screen. */
export const AGENT_LABELS: Record<AgentKind, string> = {
	codex: "Codex",
	claude: "Claude Code",
};

/** The executable each agent is spawned as, when the config does not name another path. */
export const AGENT_EXECUTABLES: Record<AgentKind, string> = {
	codex: "codex",
	claude: "claude",
};

export function isAgentKind(value: string): value is AgentKind {
	return (AGENT_KINDS as readonly string[]).includes(value);
}

/**
 * How hard the agent should think. Which levels exist depends on the agent and on the model, and
 * changes with every release, so this is a plain string checked only for shape. Each agent's
 * catalog is the source of truth, and the settings screen offers what it reports.
 */
export type EffortLevel = string;

/**
 * `read-only` lets the agent read anything but change nothing; `workspace-write` lets it write
 * inside its own working directory. Neither can stop `gh` from writing, which is why the read-only
 * rule is also carried by the prompt (ADR 0003).
 */
export type AgentSandbox = "read-only" | "workspace-write";

/** How one job should be run: which agent, which model, how hard, and for how long. */
export interface AgentProfile {
	agent: AgentKind;
	/** Left unset to let the agent pick its own default model, which ages better than a pinned name. */
	model?: string | undefined;
	effort: EffortLevel;
	timeoutMinutes: number;
}

export type AgentErrorKind =
	"not_installed" | "timeout" | "aborted" | "invalid_output" | "no_output" | "failed";

export class AgentError extends Error {
	readonly kind: AgentErrorKind;
	readonly agent: AgentKind;
	/** Where the full stdout and stderr of the run were written. */
	readonly logPath: string;
	readonly exitCode: number | null;

	constructor(
		kind: AgentErrorKind,
		message: string,
		details: { agent: AgentKind; logPath: string; exitCode?: number | null; cause?: unknown },
	) {
		super(message, { cause: details.cause });
		this.name = "AgentError";
		this.kind = kind;
		this.agent = details.agent;
		this.logPath = details.logPath;
		this.exitCode = details.exitCode ?? null;
	}
}

export interface AgentUsage {
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	/** Zero for agents that do not report reasoning tokens separately. */
	reasoningOutputTokens: number;
}

/** Progress worth showing while a job runs, in the words every agent's events are reduced to. */
export type AgentProgress =
	| { kind: "session"; sessionId: string }
	| { kind: "message"; text: string }
	| { kind: "command"; command: string; status: "started" | "finished"; exitCode?: number | null }
	| { kind: "turn_completed"; usage: AgentUsage | null }
	/**
	 * The agent's own last word, for agents that stream it rather than writing it to a file, along
	 * with what that run actually cost and which model actually served it.
	 */
	| {
			kind: "result";
			text: string | null;
			/** Set when the agent reported a failure in-band, which it may do while still exiting zero. */
			error: string | null;
			usage: AgentUsage | null;
			model: string | null;
	  };

export interface AgentRunOptions {
	/** Sent on stdin, so a large bundle cannot run into the argument length limit. */
	prompt: string;
	/** Working root for the agent; a worktree, never the user's own clone. */
	cwd: string;
	sandbox: AgentSandbox;
	profile: AgentProfile;
	/** JSON Schema the final message must conform to. Without it the raw text is returned. */
	schema?: unknown;
	/**
	 * Ephemeral runs leave no session behind. Assessments are ephemeral; review drafts are not,
	 * because their session id is kept for follow-ups.
	 */
	ephemeral?: boolean;
	/** A label used in the log file name, for example `assess-owner-thing-101`. */
	label: string;
	signal?: AbortSignal;
	onProgress?: (progress: AgentProgress) => void;
}

export interface AgentResult<T> {
	output: T;
	agent: AgentKind;
	/** Null for an ephemeral run, which persists nothing. */
	sessionId: string | null;
	logPath: string;
	durationMs: number;
	/** What the agent said it used, falling back to what the profile asked for. */
	model: string | null;
	/** Every shell command the agent ran, in order. */
	commands: string[];
	usage: AgentUsage | null;
}

export interface AgentRunner {
	run: <T = unknown>(options: AgentRunOptions) => Promise<AgentResult<T>>;
}

/** The files the runner prepares before spawning, and hands to the dialect to point at. */
export interface AgentRunFiles {
	/** Where an agent that writes its last message to a file should write it. */
	messagePath: string;
	/** The run's JSON Schema, written to disk; undefined when the run has no schema. */
	schemaPath: string | undefined;
}

/**
 * Everything that differs between one agent CLI and another: how a run is spelled as arguments,
 * and how to read its event stream. Adding an agent means adding one of these.
 */
export interface AgentDialect {
	kind: AgentKind;
	/** Builds the argument list for one run. The prompt always goes on stdin, never in here. */
	args: (run: AgentRunOptions, files: AgentRunFiles) => string[];
	/**
	 * Opens a reader over one run's JSONL output. It is a factory rather than a plain function
	 * because an agent may need to remember earlier lines to make sense of a later one.
	 */
	reader: () => (line: string) => AgentProgress | undefined;
	/** True when the agent writes its final message to `files.messagePath` rather than streaming it. */
	writesMessageFile: boolean;
}
