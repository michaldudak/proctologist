import { randomUUID } from "node:crypto";
import type { Store } from "../store/store.js";
import type { ListJobsOptions } from "../store/jobs.js";
import { StoreError, type Job, type JobKind, type JobProgress } from "../store/types.js";
import { Semaphore } from "../util/semaphore.js";

export interface JobContext {
	job: Job;
	/** Aborted when the user stops the job or the app shuts down. */
	signal: AbortSignal;
	setProgress: (progress: JobProgress) => void;
	/** Every Codex process in the app goes through here, so one cap covers all job kinds. */
	codexSlot: <T>(work: () => Promise<T>) => Promise<T>;
}

export type JobHandler = (context: JobContext) => Promise<void>;

export interface EnqueueJob {
	kind: JobKind;
	repository: string;
	/** The item the job is about; left out for a whole-repository refresh. */
	number?: number | null;
	/** Supply an id to make enqueueing idempotent; one is generated otherwise. */
	id?: string;
}

export interface JobRunnerOptions {
	store: Store;
	/** Concurrent Codex processes allowed across every running job. */
	concurrency: number;
	handlers: Partial<Record<JobKind, JobHandler>>;
	now?: () => string;
}

export interface JobRunner {
	/** Queues and starts a job. Throws a StoreError if a refresh of that repository is running. */
	enqueue: (job: EnqueueJob) => Job;
	/** Asks a running job to stop. Returns false if it was not running. */
	abort: (id: string) => boolean;
	get: (id: string) => Job | undefined;
	list: (options?: ListJobsOptions) => Job[];
	/** Resolves once the job has finished, whatever the outcome. */
	wait: (id: string) => Promise<Job>;
	onChange: (listener: (job: Job) => void) => () => void;
	/** Fails jobs a previous process left running, so a crash does not hold the refresh lock. */
	recoverInterrupted: () => number;
	/** Aborts everything still running and waits for it to stop. */
	shutdown: () => Promise<void>;
}

interface Running {
	controller: AbortController;
	finished: Promise<void>;
}

export function createJobRunner(options: JobRunnerOptions): JobRunner {
	const { store } = options;
	const now = options.now ?? ((): string => new Date().toISOString());
	const codexSlots = new Semaphore(options.concurrency);
	const running = new Map<string, Running>();
	const listeners = new Set<(job: Job) => void>();

	const announce = (id: string): void => {
		const job = store.jobs.get(id);
		if (!job) {
			return;
		}
		for (const listener of listeners) {
			listener(job);
		}
	};

	const execute = async (job: Job, controller: AbortController): Promise<void> => {
		const handler = options.handlers[job.kind];
		if (!handler) {
			store.jobs.finish(job.id, "failed", now(), `No handler for a ${job.kind} job.`);
			announce(job.id);
			return;
		}

		store.jobs.start(job.id, now());
		announce(job.id);

		try {
			await handler({
				job,
				signal: controller.signal,
				setProgress: (progress) => {
					store.jobs.reportProgress(job.id, progress);
					announce(job.id);
				},
				codexSlot: (work) => codexSlots.run(work),
			});
			store.jobs.finish(job.id, controller.signal.aborted ? "aborted" : "completed", now(), null);
		} catch (cause) {
			// An abort surfaces as whatever error the handler threw; the signal is what decides.
			store.jobs.finish(
				job.id,
				controller.signal.aborted ? "aborted" : "failed",
				now(),
				message(cause),
			);
		} finally {
			running.delete(job.id);
			announce(job.id);
		}
	};

	return {
		enqueue: (input) => {
			const job = store.jobs.create(
				{
					id: input.id ?? randomUUID(),
					kind: input.kind,
					repository: input.repository,
					number: input.number ?? null,
				},
				now(),
			);
			announce(job.id);

			const controller = new AbortController();
			running.set(job.id, { controller, finished: execute(job, controller) });
			return job;
		},
		abort: (id) => {
			const entry = running.get(id);
			if (!entry) {
				return false;
			}
			entry.controller.abort();
			return true;
		},
		get: (id) => store.jobs.get(id),
		list: (listOptions) => store.jobs.list(listOptions),
		wait: async (id) => {
			await running.get(id)?.finished;
			const job = store.jobs.get(id);
			if (!job) {
				throw new StoreError(`There is no job ${id}.`);
			}
			return job;
		},
		onChange: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		recoverInterrupted: () => store.jobs.recoverInterrupted(now()),
		shutdown: async () => {
			for (const entry of running.values()) {
				entry.controller.abort();
			}
			await Promise.all([...running.values()].map((entry) => entry.finished));
		},
	};
}

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
