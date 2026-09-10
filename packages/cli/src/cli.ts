import { parseArgs } from "node:util";
import {
	createApp,
	derive,
	isQuickWin,
	NEXT_ACTIONS,
	toMarkdown,
	type App,
	type CreateAppOptions,
	type Job,
	type Refresh,
} from "@proctologist/core";

export interface Writer {
	write: (text: string) => void;
}

export interface CliOptions {
	argv: string[];
	stdout: Writer;
	stderr: Writer;
	/** Injected so tests can drive the CLI without a real GitHub, git or agent. */
	openApp?: (options: CreateAppOptions) => Promise<App>;
	appOptions?: CreateAppOptions;
}

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

const USAGE = `proctologist — audit the open pull requests of your repositories

Usage:
  proctologist refresh <owner/name> [--full]   Fetch, then assess what changed
  proctologist refresh --all [--full]          Refresh every tracked repository in turn
  proctologist assess <owner/name> <number> [--thorough]
                                               Assess one pull request now
  proctologist jobs [--all]                    Show running jobs, or every job with --all
  proctologist abort <id>                      Stop a running job
  proctologist repositories                    List the tracked repositories

Options:
  --effort <level>  effort level, e.g. low, medium, high; overrides the review profile
  --config <file>   Use this config file instead of the default
  --help            Show this message
`;

export async function run(options: CliOptions): Promise<number> {
	let parsed;
	try {
		parsed = parseArgs({
			args: options.argv,
			allowPositionals: true,
			strict: true,
			options: {
				full: { type: "boolean", default: false },
				all: { type: "boolean", default: false },
				thorough: { type: "boolean", default: false },
				effort: { type: "string" },
				config: { type: "string" },
				help: { type: "boolean", default: false },
			},
		});
	} catch (cause) {
		options.stderr.write(`${message(cause)}\n\n${USAGE}`);
		return EXIT_USAGE;
	}

	const [command, ...rest] = parsed.positionals;
	const flags = parsed.values;

	if (flags.help || command === undefined || command === "help") {
		options.stdout.write(USAGE);
		return command === undefined && !flags.help ? EXIT_USAGE : EXIT_OK;
	}

	const openApp = options.openApp ?? createApp;
	let app: App;
	try {
		app = await openApp({
			...options.appOptions,
			...(flags.config === undefined ? {} : { configFile: flags.config }),
		});
	} catch (cause) {
		options.stderr.write(`${message(cause)}\n`);
		return EXIT_FAILED;
	}

	try {
		switch (command) {
			case "refresh": {
				return await refreshCommand(app, options, rest, flags.all, flags.full);
			}
			case "assess": {
				return await assessCommand(app, options, rest, flags.thorough);
			}
			case "review": {
				return await reviewCommand(app, options, rest, flags.effort);
			}
			case "jobs": {
				return jobsCommand(app, options, flags.all);
			}
			case "abort": {
				return abortCommand(app, options, rest);
			}
			case "repositories": {
				return repositoriesCommand(app, options);
			}
			default: {
				options.stderr.write(`Unknown command "${command}".\n\n${USAGE}`);
				return EXIT_USAGE;
			}
		}
	} catch (cause) {
		options.stderr.write(`${message(cause)}\n`);
		return EXIT_FAILED;
	} finally {
		await app.close();
	}
}

async function refreshCommand(
	app: App,
	options: CliOptions,
	positionals: string[],
	all: boolean,
	full: boolean,
): Promise<number> {
	const repositories = all
		? app.config.repositories.map((entry) => entry.name)
		: positionals.slice(0, 1);

	if (repositories.length === 0) {
		options.stderr.write(
			all
				? "No repositories are tracked yet. Add one to the config file first.\n"
				: `Which repository? Use "proctologist refresh <owner/name>" or --all.\n`,
		);
		return all ? EXIT_FAILED : EXIT_USAGE;
	}

	let failed = false;
	for (const repository of repositories) {
		const job = app.startRefresh(repository, { full });
		// The refresh and the assessment it queues are both this command's business.
		const unsubscribe = app.jobs.onChange((changed) => {
			if ((changed.id === job.id || changed.parentId === job.id) && changed.progress) {
				options.stderr.write(`${repository}: ${describeProgress(changed)}\n`);
			}
		});

		// Refreshes run one repository at a time on purpose.
		// oxlint-disable-next-line no-await-in-loop
		const finished = await app.jobs.wait(job.id);
		const record = app.store.refreshes.latest(repository);
		options.stdout.write(`${repository}: ${describeRefresh(finished, record)}\n`);
		if (finished.state !== "completed" || record?.outcome === "failed") {
			failed = true;
		}

		const assessment = app.jobs
			.list({ repository, limit: 20 })
			.find((candidate) => candidate.parentId === job.id);
		if (assessment) {
			// oxlint-disable-next-line no-await-in-loop
			const done = await app.jobs.wait(assessment.id);
			options.stdout.write(`${repository}: ${describeAssessments(done)}\n`);
			if (done.state !== "completed") {
				failed = true;
			}
		}
		unsubscribe();
	}

	return failed ? EXIT_FAILED : EXIT_OK;
}

async function assessCommand(
	app: App,
	options: CliOptions,
	positionals: string[],
	thorough: boolean,
): Promise<number> {
	const [repository, numberArg] = positionals;
	const number = Number(numberArg);

	if (!repository || !Number.isInteger(number) || number <= 0) {
		options.stderr.write(`Usage: proctologist assess <owner/name> <number> [--thorough]\n`);
		return EXIT_USAGE;
	}

	options.stderr.write(
		`${repository}#${String(number)}: running a ${thorough ? "thorough" : "quick"} assessment\n`,
	);

	const job = thorough
		? app.startThoroughAssessment(repository, number)
		: app.startQuickAssessment(repository, number);
	const finished = await app.jobs.wait(job.id);
	const assessment =
		finished.state === "completed"
			? app.store.assessments.current({ repository, number })
			: undefined;

	if (!assessment) {
		options.stderr.write("The assessment did not finish.\n");
		return EXIT_FAILED;
	}
	if (!assessment.verdict) {
		options.stdout.write(
			`${repository}#${String(number)}: unassessed — ${assessment.error ?? "unknown error"}\n`,
		);
		return EXIT_FAILED;
	}

	const verdict = assessment.verdict;
	options.stdout.write(
		[
			`${repository}#${String(number)}: ${NEXT_ACTIONS[verdict.nextAction]}${
				isQuickWin(verdict) ? " (quick win)" : ""
			}`,
			`  ${verdict.summary}`,
			`  category ${verdict.category}, relevance ${verdict.relevance}, status ${verdict.status}, effort ${verdict.effort}`,
			`  ${verdict.nextActionReason}`,
			"",
		].join("\n"),
	);
	return EXIT_OK;
}

async function reviewCommand(
	app: App,
	options: CliOptions,
	positionals: string[],
	effort: string | undefined,
): Promise<number> {
	const [repository, numberArg] = positionals;
	const number = Number(numberArg);

	if (!repository || !Number.isInteger(number) || number <= 0) {
		options.stderr.write("Usage: proctologist review <owner/name> <number> [--effort <level>]\n");
		return EXIT_USAGE;
	}
	if (effort !== undefined && !isEffortLevel(effort)) {
		options.stderr.write(
			"Effort must be a level such as low, medium or high. Which levels exist depends on the" +
				" agent and the model; the settings screen offers the ones each agent reports.\n",
		);
		return EXIT_USAGE;
	}

	options.stderr.write(`${repository}#${String(number)}: drafting a review\n`);
	const job = app.startReviewDraft(repository, number, { effort });
	const finished = await app.jobs.wait(job.id);

	if (finished.state !== "completed") {
		options.stderr.write(`The review draft ${finished.state}: ${finished.error ?? ""}\n`);
		return EXIT_FAILED;
	}

	const draft = app.store.reviewDrafts.latest({ repository, number });
	if (!draft) {
		options.stderr.write("No review draft was stored.\n");
		return EXIT_FAILED;
	}

	options.stdout.write(toMarkdown(draft));
	return EXIT_OK;
}

/** Only the shape is checked here; the agent is the authority on which levels a model accepts. */
function isEffortLevel(value: string): boolean {
	return /^[a-z][a-z0-9]*$/.test(value);
}

function jobsCommand(app: App, options: CliOptions, all: boolean): number {
	const jobs = app.jobs.list(all ? {} : { active: true });
	if (jobs.length === 0) {
		options.stdout.write(all ? "No jobs yet.\n" : "Nothing is running.\n");
		return EXIT_OK;
	}

	for (const job of jobs) {
		const target = job.number === null ? job.repository : `${job.repository}#${String(job.number)}`;
		options.stdout.write(
			`${job.id}  ${job.kind}  ${target}  ${job.state}${
				job.progress ? `  ${describeProgress(job)}` : ""
			}${job.error ? `  ${job.error}` : ""}\n`,
		);
	}
	return EXIT_OK;
}

function abortCommand(app: App, options: CliOptions, positionals: string[]): number {
	const [id] = positionals;
	if (!id) {
		options.stderr.write("Usage: proctologist abort <id>\n");
		return EXIT_USAGE;
	}
	if (!app.jobs.abort(id)) {
		options.stderr.write(`No running job ${id}.\n`);
		return EXIT_FAILED;
	}
	options.stdout.write(`Asked job ${id} to stop.\n`);
	return EXIT_OK;
}

function repositoriesCommand(app: App, options: CliOptions): number {
	if (app.config.repositories.length === 0) {
		options.stdout.write(`No repositories are tracked yet. Add one to ${app.paths.configFile}.\n`);
		return EXIT_OK;
	}

	const now = new Date().toISOString();
	for (const entry of app.config.repositories) {
		const pullRequests = app.store.pullRequests.list(entry.name);
		const quickWins = pullRequests.filter((pullRequest) => {
			const assessment = app.store.assessments.current(pullRequest);
			return derive(
				{
					pullRequest,
					assessment,
					previousAssessment: undefined,
					hasNote: false,
					snooze: undefined,
				},
				now,
			).quickWin;
		}).length;

		options.stdout.write(
			`${entry.name}  ${String(pullRequests.length)} open  ${String(quickWins)} quick wins${
				entry.clone ? "" : "  (no local clone)"
			}\n`,
		);
	}
	return EXIT_OK;
}

function describeProgress(job: Job): string {
	const progress = job.progress;
	if (!progress) {
		return job.state;
	}
	return progress.label ?? `${String(progress.done)}/${String(progress.total)}`;
}

function describeRefresh(job: Job, record: Refresh | undefined): string {
	if (job.state === "failed") {
		return `failed — ${job.error ?? "unknown error"}`;
	}
	if (!record) {
		return job.state;
	}
	const { counts } = record;
	const parts = [
		`${String(counts.fetched)} open`,
		`${String(counts.added)} new`,
		`${String(counts.closed)} closed`,
		`${String(counts.due)} to assess`,
	];
	const suffix = record.error ? ` — ${record.error}` : "";
	return `${record.outcome} (${parts.join(", ")})${suffix}`;
}

function describeAssessments(job: Job): string {
	if (job.state === "failed") {
		return `assessment failed — ${job.error ?? "unknown error"}`;
	}
	const progress = job.progress;
	if (!progress) {
		return `assessment ${job.state}`;
	}
	const failed = progress.failed ?? 0;
	const parts = [
		`${String(progress.done - failed)} assessed`,
		`${String(failed)} unassessed`,
		...(job.state === "aborted" ? [`${String(progress.total - progress.done)} skipped`] : []),
	];
	return `assessment ${job.state} (${parts.join(", ")})`;
}

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
