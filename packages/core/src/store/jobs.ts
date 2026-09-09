import type { Database } from "better-sqlite3";
import { fromJson, toJson } from "./rows.js";
import {
	StoreError,
	type ItemKind,
	type Job,
	type JobKind,
	type JobProgress,
	type JobState,
	type NewJob,
} from "./types.js";

interface JobRow {
	id: string;
	kind: string;
	repository: string;
	item_kind: string | null;
	number: number | null;
	state: string;
	progress: string | null;
	error: string | null;
	created_at: string;
	started_at: string | null;
	finished_at: string | null;
}

const ACTIVE_STATES = "('queued', 'running')";

export interface ListJobsOptions {
	repository?: string;
	/** Queued or running only. */
	active?: boolean;
	limit?: number;
}

export interface JobRepository {
	/**
	 * Queues a job. Throws when a refresh of the same repository is already queued or running; the
	 * database enforces this, so the desktop app and the CLI cannot both start one.
	 */
	create: (job: NewJob, now: string) => Job;
	get: (id: string) => Job | undefined;
	start: (id: string, now: string) => void;
	reportProgress: (id: string, progress: JobProgress) => void;
	finish: (id: string, state: JobState, now: string, error?: string | null) => void;
	list: (options?: ListJobsOptions) => Job[];
	/** Fails jobs left active by a previous process, so a crash does not hold a lock forever. */
	recoverInterrupted: (now: string, reason?: string) => number;
}

export function createJobRepository(db: Database): JobRepository {
	const insert = db.prepare(`
		INSERT INTO jobs (id, kind, repository, item_kind, number, state, progress, error, created_at)
		VALUES (@id, @kind, @repository, @item_kind, @number, 'queued', NULL, NULL, @created_at)
	`);
	const selectOne = db.prepare("SELECT * FROM jobs WHERE id = ?");
	const start = db.prepare(
		"UPDATE jobs SET state = 'running', started_at = ? WHERE id = ? AND state = 'queued'",
	);
	const setProgress = db.prepare("UPDATE jobs SET progress = ? WHERE id = ?");
	const finish = db.prepare("UPDATE jobs SET state = ?, finished_at = ?, error = ? WHERE id = ?");
	const recover = db.prepare(`
		UPDATE jobs SET state = 'failed', finished_at = @now, error = @reason
		WHERE state IN ${ACTIVE_STATES}
	`);

	const selectors = {
		all: db.prepare("SELECT * FROM jobs ORDER BY created_at DESC, id DESC LIMIT ?"),
		active: db.prepare(
			`SELECT * FROM jobs WHERE state IN ${ACTIVE_STATES} ORDER BY created_at ASC LIMIT ?`,
		),
		byRepository: db.prepare(
			"SELECT * FROM jobs WHERE repository = ? ORDER BY created_at DESC, id DESC LIMIT ?",
		),
		activeByRepository: db.prepare(
			`SELECT * FROM jobs WHERE repository = ? AND state IN ${ACTIVE_STATES} ORDER BY created_at ASC LIMIT ?`,
		),
	};

	return {
		create: (job, now) => {
			const createdAt = job.createdAt ?? now;
			const itemKind: ItemKind | null =
				job.number === null || job.number === undefined ? null : (job.kindOfItem ?? "pull_request");
			try {
				insert.run({
					id: job.id,
					kind: job.kind,
					repository: job.repository,
					item_kind: itemKind,
					number: job.number ?? null,
					created_at: createdAt,
				});
			} catch (cause) {
				throw new StoreError(
					`Could not queue a ${job.kind} job for ${job.repository}: one is already running`,
					{ cause },
				);
			}

			return {
				id: job.id,
				kind: job.kind,
				repository: job.repository,
				itemKind,
				number: job.number ?? null,
				state: "queued",
				progress: null,
				error: null,
				createdAt,
				startedAt: null,
				finishedAt: null,
			};
		},
		get: (id) => {
			const row = selectOne.get(id) as JobRow | undefined;
			return row ? fromRow(row) : undefined;
		},
		start: (id, now) => {
			if (start.run(now, id).changes === 0) {
				throw new StoreError(`Job ${id} is not queued and cannot be started`);
			}
		},
		reportProgress: (id, progress) => {
			setProgress.run(toJson(progress), id);
		},
		finish: (id, state, now, error = null) => {
			finish.run(state, now, error, id);
		},
		list: (options = {}) => {
			const limit = options.limit ?? 100;
			const rows = options.repository
				? (options.active ? selectors.activeByRepository : selectors.byRepository).all(
						options.repository,
						limit,
					)
				: (options.active ? selectors.active : selectors.all).all(limit);
			return (rows as JobRow[]).map(fromRow);
		},
		recoverInterrupted: (now, reason = "Interrupted by an app restart") =>
			recover.run({ now, reason }).changes,
	};
}

function fromRow(row: JobRow): Job {
	return {
		id: row.id,
		kind: row.kind as JobKind,
		repository: row.repository,
		itemKind: row.item_kind as ItemKind | null,
		number: row.number,
		state: row.state as JobState,
		progress: fromJson<JobProgress | null>(row.progress, null),
		error: row.error,
		createdAt: row.created_at,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
	};
}
