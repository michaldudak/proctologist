import { parse as parseToml, stringify as stringifyToml, TomlError } from "smol-toml";
import { z } from "zod";
import { AGENT_KINDS, type AgentKind, type AgentProfile } from "../agents/types.js";

/** The three jobs an agent is asked to do, each with its own profile. */
export const PROFILE_NAMES = ["assess", "thorough", "review"] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];

const EFFORT_PATTERN = /^[a-z][a-z0-9]*$/;

/** See `adoptConfig`: a guard against looping, not a limit anyone should ever reach. */
const MAX_ADOPTION_ROUNDS = 100;

export interface TrackedRepository {
	/** `owner/name`, as GitHub writes it. */
	name: string;
	owner: string;
	repo: string;
	/** Local clone used as the object store for worktrees. */
	clone?: string | undefined;
	/** Free text appended to the built-in assessment prompt, for a quick pass and a thorough one. */
	context?: string | undefined;
	/** Free text appended to a thorough assessment prompt only, after the context. */
	thoroughInstructions?: string | undefined;
	/** Free text used as the review draft prompt. */
	reviewInstructions?: string | undefined;
	profiles: Partial<Record<ProfileName, Partial<AgentProfile>>>;
}

export interface Config {
	/** Fetches every tracked repository in the background, this often. Never assesses. */
	schedule: { enabled: boolean; intervalMinutes: number };
	concurrency: number;
	/** How many pull requests one quick-assessment agent run is handed at most. */
	assessmentChunkSize: number;
	outdatedAfterDays: number;
	closedRetentionDays: number;
	diffCutoffKb: number;
	/** Above this many pull requests, a refresh asks before assessing. 0 never asks. */
	confirmAssessmentsAbove: number;
	/** Overrides where the database lives; the cache always stays in the platform cache folder. */
	dataDir?: string | undefined;
	profiles: Record<ProfileName, AgentProfile>;
	repositories: TrackedRepository[];
}

/** Thrown for anything the user can fix by editing the config file. */
export class ConfigError extends Error {
	readonly issues: string[];

	constructor(message: string, issues: string[] = []) {
		super(
			issues.length > 0 ? `${message}\n${issues.map((issue) => `  ${issue}`).join("\n")}` : message,
		);
		this.name = "ConfigError";
		this.issues = issues;
	}
}

/** Model and effort have no defaults of their own: left out, the agent decides both. */
const PROFILE_DEFAULTS: Record<ProfileName, { agent: AgentKind; timeout: number }> = {
	assess: { agent: "codex", timeout: 3 },
	thorough: { agent: "codex", timeout: 20 },
	review: { agent: "codex", timeout: 30 },
};

const REPOSITORY_SEGMENT = String.raw`[A-Za-z0-9._-]*[A-Za-z0-9_-][A-Za-z0-9._-]*`;
const REPOSITORY_PATTERN = new RegExp(`^${REPOSITORY_SEGMENT}/${REPOSITORY_SEGMENT}$`);

const wholeNumber = z.int().nonnegative();
const agentKind = z.enum(AGENT_KINDS);
const effort = z
	.string()
	.regex(EFFORT_PATTERN, "must be an effort level such as low, medium or high");

function profileSchema(name: ProfileName) {
	const defaults = PROFILE_DEFAULTS[name];
	return z
		.strictObject({
			agent: agentKind.default(defaults.agent),
			model: z.string().min(1).optional(),
			effort: effort.optional(),
			timeout_minutes: z.number().positive().default(defaults.timeout),
		})
		.prefault({});
}

const profileOverrideSchema = z.strictObject({
	agent: agentKind.optional(),
	model: z.string().min(1).optional(),
	effort: effort.optional(),
	timeout_minutes: z.number().positive().optional(),
});

const profilesSchema = z
	.strictObject({
		assess: profileSchema("assess"),
		thorough: profileSchema("thorough"),
		review: profileSchema("review"),
	})
	.prefault({});

const repositorySchema = z.strictObject({
	name: z
		.string()
		.regex(REPOSITORY_PATTERN, "must be written as owner/name, for example octocat/hello-world"),
	clone: z.string().min(1).optional(),
	context: z.string().optional(),
	thorough_instructions: z.string().optional(),
	review_instructions: z.string().optional(),
	profiles: z
		.strictObject({
			assess: profileOverrideSchema.optional(),
			thorough: profileOverrideSchema.optional(),
			review: profileOverrideSchema.optional(),
		})
		.prefault({}),
});

const fileSchema = z
	.strictObject({
		schedule: z
			.strictObject({
				enabled: z.boolean().default(true),
				interval_minutes: z.int().min(5).default(60),
			})
			.prefault({}),
		concurrency: z.int().min(1).max(32).default(6),
		assessment_chunk_size: z.int().min(1).default(16),
		outdated_after_days: z.int().min(1).default(14),
		closed_retention_days: wholeNumber.default(30),
		diff_cutoff_kb: z.int().min(1).default(60),
		confirm_assessments_above: wholeNumber.default(50),
		data_dir: z.string().min(1).optional(),
		profiles: profilesSchema,
		repositories: z.array(repositorySchema).default([]),
	})
	.superRefine((value, ctx) => {
		const seen = new Set<string>();
		for (const [index, repository] of value.repositories.entries()) {
			if (seen.has(repository.name)) {
				ctx.addIssue({
					code: "custom",
					path: ["repositories", index, "name"],
					message: `"${repository.name}" is tracked more than once`,
				});
			}
			seen.add(repository.name);
		}
	});

type ConfigFile = z.infer<typeof fileSchema>;

export const defaultConfig: Config = toConfig(fileSchema.parse({}));

/** Parses and validates config file text. `source` only ever appears in error messages. */
export function parseConfig(text: string, source?: string): Config {
	const result = fileSchema.safeParse(readFileText(text, source));
	if (!result.success) {
		throw configError(result.error, source);
	}

	return toConfig(result.data);
}

export interface AdoptedConfig {
	config: Config;
	/** What had to be left out, each written as a path such as `repositories.0.clone`. */
	ignored: string[];
}

/**
 * Reads a config file this build may not fully understand — one written by another version of the
 * app, which may have added keys, dropped them, or changed what they hold — keeping everything it
 * recognises and leaving out the rest. Copying a config into an ephemeral workspace is the one
 * place that is wanted: a build under test must start even when the file ahead of it mentions
 * things it has never heard of. Everywhere else an unknown key is a typo, and `parseConfig` still
 * says so.
 */
export function adoptConfig(text: string, source?: string): AdoptedConfig {
	let raw = readFileText(text, source);
	const ignored: string[] = [];

	// Each round leaves out at least one thing, so this always ends; the cap is only there in case
	// a mistake here ever makes that untrue.
	for (let round = 0; round < MAX_ADOPTION_ROUNDS; round += 1) {
		const result = fileSchema.safeParse(raw);
		if (result.success) {
			return { config: toConfig(result.data), ignored };
		}

		const paths = unreadablePaths(raw, result.error.issues);
		if (paths.length === 0) {
			throw configError(result.error, source);
		}
		for (const path of paths) {
			ignored.push(path.join("."));
		}
		// Taking an entry out of a list moves everything after it up, so the later entries go first:
		// otherwise a second removal would land on the entry that had been standing behind the first.
		for (const path of paths.toSorted(laterEntryFirst)) {
			raw = withoutPath(raw, path);
		}
	}

	throw new ConfigError(`Could not make sense of the config file${where(source)}.`);
}

/** Parses the file text as TOML and reads the shapes older versions wrote as the current one. */
function readFileText(text: string, source?: string): unknown {
	let raw: unknown;
	try {
		raw = parseToml(text);
	} catch (cause) {
		const detail = cause instanceof TomlError ? cause.message : String(cause);
		throw new ConfigError(`Could not parse the config file${where(source)}: ${detail}`);
	}

	return fromDailySchedule(fromCodexOnly(raw));
}

function configError(error: z.ZodError, source?: string): ConfigError {
	const issues = error.issues.map(
		(issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
	);
	return new ConfigError(
		`The config file${where(source)} has ${issues.length === 1 ? "a problem" : "problems"}:`,
		issues,
	);
}

function where(source: string | undefined): string {
	return source ? ` in ${source}` : "";
}

/**
 * Which parts of the file to leave out to get past these complaints. An unknown key is dropped on
 * its own, since the rest of the table around it is still readable. Anything else means a key this
 * build knows holds something it does not expect: the key goes, and its default takes over —
 * except inside a list, where a half-read entry is worth less than no entry, so the whole entry
 * goes.
 */
function unreadablePaths(raw: unknown, issues: readonly z.core.$ZodIssue[]): PropertyKey[][] {
	const paths = issues.flatMap((issue) =>
		issue.code === "unrecognized_keys"
			? issue.keys.map((key) => [...issue.path, key])
			: [entryPath(raw, issue.path)],
	);

	// Two issues can name the same place, and a place inside one that is going anyway goes with it;
	// either would otherwise be counted twice in what the user is told was left out.
	const seen = new Set<string>();
	return paths.filter((path) => {
		const key = path.join("\u0000");
		if (path.length === 0 || seen.has(key)) {
			return false;
		}
		if (paths.some((other) => other.length < path.length && isPrefix(other, path))) {
			return false;
		}
		seen.add(key);
		return true;
	});
}

/** The path cut back to the list entry it is inside, when it is inside one. */
function entryPath(raw: unknown, path: readonly PropertyKey[]): PropertyKey[] {
	let value = raw;
	for (const [index, key] of path.entries()) {
		if (Array.isArray(value)) {
			return path.slice(0, index + 1);
		}
		if (typeof value !== "object" || value === null) {
			break;
		}
		value = (value as Record<string, unknown>)[String(key)];
	}
	return [...path];
}

function isPrefix(prefix: readonly PropertyKey[], path: readonly PropertyKey[]): boolean {
	return prefix.every((key, index) => key === path[index]);
}

/**
 * Puts the later of two list entries first, and otherwise keeps the two in some fixed order, so
 * that removing paths one by one in this order never moves a path still to come.
 */
function laterEntryFirst(left: readonly PropertyKey[], right: readonly PropertyKey[]): number {
	const shared = Math.min(left.length, right.length);
	for (let depth = 0; depth < shared; depth += 1) {
		const here = left[depth];
		const there = right[depth];
		if (here === there) {
			continue;
		}
		const hereIndex = Number(here);
		const thereIndex = Number(there);
		if (Number.isInteger(hereIndex) && Number.isInteger(thereIndex)) {
			return thereIndex - hereIndex;
		}
		return String(here) < String(there) ? -1 : 1;
	}
	return right.length - left.length;
}

/** A copy of `value` without the node at `path`; containers along the way are copied, not edited. */
function withoutPath(value: unknown, path: readonly PropertyKey[]): unknown {
	const [head, ...rest] = path;
	if (head === undefined) {
		return value;
	}

	if (Array.isArray(value)) {
		const index = Number(head);
		if (!Number.isInteger(index) || index < 0 || index >= value.length) {
			return value;
		}
		return rest.length === 0
			? value.filter((_item, position) => position !== index)
			: value.map((item, position) => (position === index ? withoutPath(item, rest) : item));
	}

	if (typeof value !== "object" || value === null) {
		return value;
	}

	const record = value as Record<string, unknown>;
	const key = String(head);
	if (!(key in record)) {
		return value;
	}
	if (rest.length > 0) {
		return { ...record, [key]: withoutPath(record[key], rest) };
	}
	const { [key]: _dropped, ...kept } = record;
	return kept;
}

/**
 * Reads the shape the config file had while Codex was the only agent — `[codex.profiles.x]` with
 * `reasoning_effort` — as the agent-neutral shape. Files are rewritten in the new shape the next
 * time they are saved, so this only has to carry a file across one upgrade.
 */
function fromCodexOnly(raw: unknown): unknown {
	if (typeof raw !== "object" || raw === null) {
		return raw;
	}

	const value = { ...(raw as Record<string, unknown>) };
	const codex = value["codex"];
	if (typeof codex === "object" && codex !== null && value["profiles"] === undefined) {
		value["profiles"] = renameEffort((codex as { profiles?: unknown }).profiles);
	}
	delete value["codex"];

	if (Array.isArray(value["repositories"])) {
		value["repositories"] = value["repositories"].map((entry: unknown) =>
			typeof entry === "object" && entry !== null ? fromCodexOnly(entry) : entry,
		);
	}

	return value;
}

/**
 * Drops the time of day from the shape the schedule had while it also assessed. A background fetch
 * every hour has no use for it, and a file that still has it should keep loading.
 */
function fromDailySchedule(raw: unknown): unknown {
	if (typeof raw !== "object" || raw === null) {
		return raw;
	}
	const value = raw as Record<string, unknown>;
	const schedule = value["schedule"];
	if (typeof schedule !== "object" || schedule === null || !("time" in schedule)) {
		return raw;
	}
	const { time: _time, ...rest } = schedule as Record<string, unknown>;
	return { ...value, schedule: rest };
}

function renameEffort(profiles: unknown): unknown {
	if (typeof profiles !== "object" || profiles === null) {
		return profiles;
	}
	return Object.fromEntries(
		Object.entries(profiles as Record<string, unknown>).map(([name, profile]) => {
			if (typeof profile !== "object" || profile === null) {
				return [name, profile];
			}
			const { reasoning_effort: renamed, ...rest } = profile as Record<string, unknown>;
			return [name, renamed === undefined ? rest : { ...rest, effort: renamed }];
		}),
	);
}

/** Renders a config back to TOML. Comments are not preserved; smol-toml cannot round-trip them. */
export function serializeConfig(config: Config): string {
	const profiles = Object.fromEntries(
		PROFILE_NAMES.map((name) => [
			name,
			omitUndefined({
				agent: config.profiles[name].agent,
				model: config.profiles[name].model,
				effort: config.profiles[name].effort,
				timeout_minutes: config.profiles[name].timeoutMinutes,
			}),
		]),
	);

	return stringifyToml(
		omitUndefined({
			schedule: {
				enabled: config.schedule.enabled,
				interval_minutes: config.schedule.intervalMinutes,
			},
			concurrency: config.concurrency,
			assessment_chunk_size: config.assessmentChunkSize,
			outdated_after_days: config.outdatedAfterDays,
			closed_retention_days: config.closedRetentionDays,
			diff_cutoff_kb: config.diffCutoffKb,
			confirm_assessments_above: config.confirmAssessmentsAbove,
			data_dir: config.dataDir,
			profiles,
			repositories: config.repositories.map((repository) =>
				omitUndefined({
					name: repository.name,
					clone: repository.clone,
					context: repository.context,
					thorough_instructions: repository.thoroughInstructions,
					review_instructions: repository.reviewInstructions,
					profiles: hasOverrides(repository) ? serializeOverrides(repository) : undefined,
				}),
			),
		}),
	);
}

/** The profile a job should run with: the base profile with the repository's overrides on top. */
export function resolveProfile(
	config: Config,
	repository: string,
	profile: ProfileName,
): AgentProfile {
	const base = config.profiles[profile];
	const override = config.repositories.find((entry) => entry.name === repository)?.profiles[
		profile
	];

	return override ? { ...base, ...omitUndefined(override) } : base;
}

function toConfig(file: ConfigFile): Config {
	return {
		schedule: { enabled: file.schedule.enabled, intervalMinutes: file.schedule.interval_minutes },
		concurrency: file.concurrency,
		assessmentChunkSize: file.assessment_chunk_size,
		outdatedAfterDays: file.outdated_after_days,
		closedRetentionDays: file.closed_retention_days,
		diffCutoffKb: file.diff_cutoff_kb,
		confirmAssessmentsAbove: file.confirm_assessments_above,
		dataDir: file.data_dir,
		profiles: Object.fromEntries(
			PROFILE_NAMES.map((name) => [name, toProfile(file.profiles[name])]),
		) as Record<ProfileName, AgentProfile>,
		repositories: file.repositories.map(toRepository),
	};
}

function toProfile(profile: ConfigFile["profiles"][ProfileName]): AgentProfile {
	return {
		agent: profile.agent,
		model: profile.model,
		effort: profile.effort,
		timeoutMinutes: profile.timeout_minutes,
	};
}

function toRepository(repository: ConfigFile["repositories"][number]): TrackedRepository {
	const [owner, repo] = repository.name.split("/") as [string, string];
	const overrides: TrackedRepository["profiles"] = {};
	for (const name of PROFILE_NAMES) {
		const override = repository.profiles[name];
		if (override) {
			overrides[name] = omitUndefined({
				agent: override.agent,
				model: override.model,
				effort: override.effort,
				timeoutMinutes: override.timeout_minutes,
			});
		}
	}

	return {
		name: repository.name,
		owner,
		repo,
		clone: repository.clone,
		context: repository.context,
		thoroughInstructions: repository.thorough_instructions,
		reviewInstructions: repository.review_instructions,
		profiles: overrides,
	};
}

function hasOverrides(repository: TrackedRepository): boolean {
	return PROFILE_NAMES.some((name) => repository.profiles[name] !== undefined);
}

function serializeOverrides(repository: TrackedRepository): Record<string, unknown> {
	const profiles: Record<string, unknown> = {};
	for (const name of PROFILE_NAMES) {
		const override = repository.profiles[name];
		if (override) {
			profiles[name] = omitUndefined({
				agent: override.agent,
				model: override.model,
				effort: override.effort,
				timeout_minutes: override.timeoutMinutes,
			});
		}
	}
	return profiles;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
