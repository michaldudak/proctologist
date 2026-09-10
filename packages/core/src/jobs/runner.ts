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
	/** Every agent process in the app goes through here, so one cap covers all job kinds. */
	agentSlot: <T>(work: () => Promise<T>) => Promise<T>;
}

export type JobHandler = (context: JobContext) => Promise<void>;

export interface EnqueueJob {
	kind: JobKind;
	repository: string;
	/** The item the job is about; left out for a whole-repository refresh. */
	number?: number | null;
	/** Supply an id to make enqueueing idempotent; one is generated otherwise. */
	id?: string;
	/** The job that is queueing this one, so the two can be read as one piece of work. */
	parentId?: string | null;
	/** What the job will report before it has reported anything: its size, when that is known. */
	progress?: JobProgress | null;
	/**
	 * Jobs with the same key run one after another, in the order they were queued, while jobs with
	 * different keys run side by side. The shared agent cap applies either way.
	 */
	queueKey?: string | null;
}

export interface JobRunnerOptions {
	store: Store;
	/** Concurrent agent processes allowed across every running job. */
	concurrency: number;
	handlers: Partial<Record<JobKind, JobHandler>>;
	now?: () => string;
	/** How often to check whether another process asked one of our jobs to stop. */
	abortPollMs?: number;
}

export interface JobRunner {
	/** Queues and starts a job. Throws a StoreError if a refresh of that repository is running. */
	enqueue: (job: EnqueueJob) => Job;
	/**
	 * Asks a job to stop. A job this process is running stops at once; one started elsewhere is
	 * flagged in the database for its own process to notice.
	 */
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
	const agentSlots = new Semaphore(options.concurrency);
	const running = new Map<string, Running>();
	/** The tail of each serial queue: what the next job with that key has to wait for. */
	const queues = new Map<string, Promise<void>>();
	const listeners = new Set<(job: Job) => void>();
	let poll: NodeJS.Timeout | undefined;

	const stopPolling = (force = false): void => {
		if (poll && (force || running.size === 0)) {
			clearInterval(poll);
			poll = undefined;
		}
	};

	const startPolling = (): void => {
		poll ??= setInterval(() => {
			for (const id of store.jobs.abortRequested()) {
				running.get(id)?.controller.abort();
			}
		}, options.abortPollMs ?? 1000).unref();
	};

	const announce = (id: string): void => {
		const job = store.jobs.get(id);
		if (!job) {
			return;
		}
		for (const listener of listeners) {
			listener(job);
		}
	};

	const execute = async (
		job: Job,
		controller: AbortController,
		waitFor: Promise<void> | undefined,
	): Promise<void> => {
		try {
			const handler = options.handlers[job.kind];
			if (!handler) {
				store.jobs.finish(job.id, "failed", now(), `No handler for a ${job.kind} job.`);
				return;
			}

			// Stopped while still queued: the job never starts, and never touches the queue ahead.
			await waitFor;
			if (controller.signal.aborted) {
				store.jobs.finish(job.id, "aborted", now(), null);
				return;
			}

			store.jobs.start(job.id, now());
			announce(job.id);

			await handler({
				job,
				signal: controller.signal,
				setProgress: (progress) => {
					store.jobs.reportProgress(job.id, progress);
					announce(job.id);
				},
				agentSlot: (work) => agentSlots.run(work),
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
			stopPolling();
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
					parentId: input.parentId ?? null,
					progress: input.progress ?? null,
				},
				now(),
			);
			announce(job.id);

			const controller = new AbortController();
			const key = input.queueKey ?? null;
			const ahead = key === null ? undefined : queues.get(key);
			const finished = execute(job, controller, ahead);
			if (key !== null) {
				queues.set(key, finished);
				// `execute` never rejects, so this only ever tidies up.
				void finished.finally(() => {
					if (queues.get(key) === finished) {
						queues.delete(key);
					}
				});
			}
			running.set(job.id, { controller, finished });
			startPolling();
			return job;
		},
		abort: (id) => {
			const entry = running.get(id);
			if (entry) {
				entry.controller.abort();
				return true;
			}
			return store.jobs.requestAbort(id);
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
			stopPolling(true);
		},
	};
}

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
