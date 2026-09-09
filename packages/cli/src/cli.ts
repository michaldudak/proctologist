import { parseArgs } from "node:util";
import {
	createApp,
	derive,
	isQuickWin,
	NEXT_ACTIONS,
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
	/** Injected so tests can drive the CLI without a real GitHub, git or Codex. */
	openApp?: (options: CreateAppOptions) => Promise<App>;
	appOptions?: CreateAppOptions;
}

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;

const USAGE = `proctologist — audit the open pull requests of your repositories

Usage:
  proctologist refresh <owner/name> [--full]   Fetch and assess what changed
  proctologist refresh --all [--full]          Refresh every tracked repository in turn
  proctologist assess <owner/name> <number> [--thorough]
                                               Assess one pull request now
  proctologist jobs [--all]                    Show running jobs, or every job with --all
  proctologist abort <id>                      Stop a running job
  proctologist repositories                    List the tracked repositories

Options:
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
		const unsubscribe = app.jobs.onChange((changed) => {
			if (changed.id === job.id && changed.progress) {
				options.stderr.write(`${repository}: ${describeProgress(changed)}\n`);
			}
		});

		// Refreshes run one repository at a time on purpose.
		// oxlint-disable-next-line no-await-in-loop
		const finished = await app.jobs.wait(job.id);
		unsubscribe();

		const record = app.store.refreshes.latest(repository);
		options.stdout.write(`${repository}: ${describeRefresh(finished, record)}\n`);
		if (finished.state !== "completed" || record?.outcome === "failed") {
			failed = true;
		}
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

	const assessment = thorough
		? await app.jobs
				.wait(app.startThoroughAssessment(repository, number).id)
				.then(() => app.store.assessments.current({ repository, number }))
		: await app.refresh.runQuickAssessment(repository, number);

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
		`${String(counts.reassessed)} assessed`,
		`${String(counts.unassessed)} unassessed`,
		`${String(counts.closed)} closed`,
	];
	const suffix = record.error ? ` — ${record.error}` : "";
	return `${record.outcome} (${parts.join(", ")})${suffix}`;
}

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
