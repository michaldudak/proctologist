import type { Database } from "better-sqlite3";
import type { NewRefresh, Refresh, RefreshOutcome } from "./types.js";

interface RefreshRow {
	id: number;
	repository: string;
	started_at: string;
	finished_at: string;
	outcome: string;
	fetched: number;
	added: number;
	changed: number;
	reassessed: number;
	unassessed: number;
	closed: number;
	error: string | null;
}

export interface RefreshRepository {
	record: (refresh: NewRefresh) => Refresh;
	latest: (repository: string) => Refresh | undefined;
	/** Newest first. */
	history: (repository: string, limit?: number) => Refresh[];
}

export function createRefreshRepository(db: Database): RefreshRepository {
	const insert = db.prepare(`
		INSERT INTO refreshes (
			repository, started_at, finished_at, outcome, fetched, added, changed, reassessed,
			unassessed, closed, error
		) VALUES (
			@repository, @started_at, @finished_at, @outcome, @fetched, @added, @changed, @reassessed,
			@unassessed, @closed, @error
		)
	`);
	const selectHistory = db.prepare(
		"SELECT * FROM refreshes WHERE repository = ? ORDER BY id DESC LIMIT ?",
	);

	return {
		record: (refresh) => {
			const info = insert.run({
				repository: refresh.repository,
				started_at: refresh.startedAt,
				finished_at: refresh.finishedAt,
				outcome: refresh.outcome,
				...refresh.counts,
				error: refresh.error ?? null,
			});
			return { ...refresh, id: Number(info.lastInsertRowid), error: refresh.error ?? null };
		},
		latest: (repository) => {
			const row = selectHistory.get(repository, 1) as RefreshRow | undefined;
			return row ? fromRow(row) : undefined;
		},
		history: (repository, limit = 20) =>
			(selectHistory.all(repository, limit) as RefreshRow[]).map(fromRow),
	};
}

function fromRow(row: RefreshRow): Refresh {
	return {
		id: row.id,
		repository: row.repository,
		startedAt: row.started_at,
		finishedAt: row.finished_at,
		outcome: row.outcome as RefreshOutcome,
		counts: {
			fetched: row.fetched,
			added: row.added,
			changed: row.changed,
			reassessed: row.reassessed,
			unassessed: row.unassessed,
			closed: row.closed,
		},
		error: row.error,
	};
}
