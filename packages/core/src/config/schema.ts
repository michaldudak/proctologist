import { parse as parseToml, stringify as stringifyToml, TomlError } from "smol-toml";
import { z } from "zod";

export const CODEX_PROFILE_NAMES = ["assess", "thorough", "review"] as const;
export type CodexProfileName = (typeof CODEX_PROFILE_NAMES)[number];

/**
 * Which reasoning levels exist depends on the model and changes with every Codex release, so this
 * is a plain string checked only for shape. `codex debug models` is the source of truth, and the
 * settings screen offers what it reports.
 */
export type ReasoningEffort = string;

const REASONING_EFFORT_PATTERN = /^[a-z][a-z0-9]*$/;

export interface CodexProfile {
	/** Left unset to let Codex pick its own default model, which ages better than a pinned name. */
	model?: string | undefined;
	reasoningEffort: ReasoningEffort;
	timeoutMinutes: number;
}

export interface TrackedRepository {
	/** `owner/name`, as GitHub writes it. */
	name: string;
	owner: string;
	repo: string;
	/** Local clone used as the object store for worktrees. */
	clone?: string | undefined;
	/** Free text appended to the built-in assessment prompt. */
	context?: string | undefined;
	/** Free text used as the review draft prompt. */
	reviewInstructions?: string | undefined;
	codexProfiles: Partial<Record<CodexProfileName, Partial<CodexProfile>>>;
}

export interface Config {
	schedule: { enabled: boolean; time: string };
	concurrency: number;
	outdatedAfterDays: number;
	closedRetentionDays: number;
	diffCutoffKb: number;
	/** Above this many pull requests, a refresh asks before assessing. 0 never asks. */
	confirmAssessmentsAbove: number;
	/** Overrides where the database lives; the cache always stays in the platform cache folder. */
	dataDir?: string | undefined;
	codexProfiles: Record<CodexProfileName, CodexProfile>;
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

const PROFILE_DEFAULTS: Record<CodexProfileName, { effort: ReasoningEffort; timeout: number }> = {
	assess: { effort: "medium", timeout: 3 },
	thorough: { effort: "high", timeout: 20 },
	review: { effort: "high", timeout: 30 },
};

const REPOSITORY_SEGMENT = String.raw`[A-Za-z0-9._-]*[A-Za-z0-9_-][A-Za-z0-9._-]*`;
const REPOSITORY_PATTERN = new RegExp(`^${REPOSITORY_SEGMENT}/${REPOSITORY_SEGMENT}$`);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const wholeNumber = z.int().nonnegative();

function profileSchema(name: CodexProfileName) {
	const defaults = PROFILE_DEFAULTS[name];
	return z
		.strictObject({
			model: z.string().min(1).optional(),
			reasoning_effort: z
				.string()
				.regex(REASONING_EFFORT_PATTERN, "must be a reasoning level such as low, medium or high")
				.default(defaults.effort),
			timeout_minutes: z.number().positive().default(defaults.timeout),
		})
		.prefault({});
}

const profileOverrideSchema = z.strictObject({
	model: z.string().min(1).optional(),
	reasoning_effort: z.string().regex(REASONING_EFFORT_PATTERN).optional(),
	timeout_minutes: z.number().positive().optional(),
});

const codexSchema = z
	.strictObject({
		profiles: z
			.strictObject({
				assess: profileSchema("assess"),
				thorough: profileSchema("thorough"),
				review: profileSchema("review"),
			})
			.prefault({}),
	})
	.prefault({});

const repositorySchema = z.strictObject({
	name: z
		.string()
		.regex(REPOSITORY_PATTERN, "must be written as owner/name, for example octocat/hello-world"),
	clone: z.string().min(1).optional(),
	context: z.string().optional(),
	review_instructions: z.string().optional(),
	codex: z
		.strictObject({
			profiles: z
				.strictObject({
					assess: profileOverrideSchema.optional(),
					thorough: profileOverrideSchema.optional(),
					review: profileOverrideSchema.optional(),
				})
				.prefault({}),
		})
		.prefault({}),
});

const fileSchema = z
	.strictObject({
		schedule: z
			.strictObject({
				enabled: z.boolean().default(false),
				time: z
					.string()
					.regex(TIME_PATTERN, "must be a 24-hour time, for example 08:00")
					.default("08:00"),
			})
			.prefault({}),
		concurrency: z.int().min(1).max(32).default(6),
		outdated_after_days: z.int().min(1).default(14),
		closed_retention_days: wholeNumber.default(30),
		diff_cutoff_kb: z.int().min(1).default(60),
		confirm_assessments_above: wholeNumber.default(50),
		data_dir: z.string().min(1).optional(),
		codex: codexSchema,
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
	let raw: unknown;
	try {
		raw = parseToml(text);
	} catch (cause) {
		const where = source ? ` in ${source}` : "";
		const detail = cause instanceof TomlError ? cause.message : String(cause);
		throw new ConfigError(`Could not parse the config file${where}: ${detail}`);
	}

	const result = fileSchema.safeParse(raw);
	if (!result.success) {
		const issues = result.error.issues.map(
			(issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
		);
		const where = source ? ` in ${source}` : "";
		throw new ConfigError(
			`The config file${where} has ${issues.length === 1 ? "a problem" : "problems"}:`,
			issues,
		);
	}

	return toConfig(result.data);
}

/** Renders a config back to TOML. Comments are not preserved; smol-toml cannot round-trip them. */
export function serializeConfig(config: Config): string {
	const profiles = Object.fromEntries(
		CODEX_PROFILE_NAMES.map((name) => [
			name,
			omitUndefined({
				model: config.codexProfiles[name].model,
				reasoning_effort: config.codexProfiles[name].reasoningEffort,
				timeout_minutes: config.codexProfiles[name].timeoutMinutes,
			}),
		]),
	);

	return stringifyToml(
		omitUndefined({
			schedule: { enabled: config.schedule.enabled, time: config.schedule.time },
			concurrency: config.concurrency,
			outdated_after_days: config.outdatedAfterDays,
			closed_retention_days: config.closedRetentionDays,
			diff_cutoff_kb: config.diffCutoffKb,
			confirm_assessments_above: config.confirmAssessmentsAbove,
			data_dir: config.dataDir,
			codex: { profiles },
			repositories: config.repositories.map((repository) =>
				omitUndefined({
					name: repository.name,
					clone: repository.clone,
					context: repository.context,
					review_instructions: repository.reviewInstructions,
					codex: hasOverrides(repository)
						? { profiles: serializeOverrides(repository) }
						: undefined,
				}),
			),
		}),
	);
}

/** The profile a job should run with: the base profile with the repository's overrides on top. */
export function resolveCodexProfile(
	config: Config,
	repository: string,
	profile: CodexProfileName,
): CodexProfile {
	const base = config.codexProfiles[profile];
	const override = config.repositories.find((entry) => entry.name === repository)?.codexProfiles[
		profile
	];

	return override ? { ...base, ...omitUndefined(override) } : base;
}

function toConfig(file: ConfigFile): Config {
	return {
		schedule: file.schedule,
		concurrency: file.concurrency,
		outdatedAfterDays: file.outdated_after_days,
		closedRetentionDays: file.closed_retention_days,
		diffCutoffKb: file.diff_cutoff_kb,
		confirmAssessmentsAbove: file.confirm_assessments_above,
		dataDir: file.data_dir,
		codexProfiles: Object.fromEntries(
			CODEX_PROFILE_NAMES.map((name) => [name, toProfile(file.codex.profiles[name])]),
		) as Record<CodexProfileName, CodexProfile>,
		repositories: file.repositories.map(toRepository),
	};
}

function toProfile(profile: ConfigFile["codex"]["profiles"][CodexProfileName]): CodexProfile {
	return {
		model: profile.model,
		reasoningEffort: profile.reasoning_effort,
		timeoutMinutes: profile.timeout_minutes,
	};
}

function toRepository(repository: ConfigFile["repositories"][number]): TrackedRepository {
	const [owner, repo] = repository.name.split("/") as [string, string];
	const overrides: TrackedRepository["codexProfiles"] = {};
	for (const name of CODEX_PROFILE_NAMES) {
		const override = repository.codex.profiles[name];
		if (override) {
			overrides[name] = omitUndefined({
				model: override.model,
				reasoningEffort: override.reasoning_effort,
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
		reviewInstructions: repository.review_instructions,
		codexProfiles: overrides,
	};
}

function hasOverrides(repository: TrackedRepository): boolean {
	return CODEX_PROFILE_NAMES.some((name) => repository.codexProfiles[name] !== undefined);
}

function serializeOverrides(repository: TrackedRepository): Record<string, unknown> {
	const profiles: Record<string, unknown> = {};
	for (const name of CODEX_PROFILE_NAMES) {
		const override = repository.codexProfiles[name];
		if (override) {
			profiles[name] = omitUndefined({
				model: override.model,
				reasoning_effort: override.reasoningEffort,
				timeout_minutes: override.timeoutMinutes,
			});
		}
	}
	return profiles;
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
