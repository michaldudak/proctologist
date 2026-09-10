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
	closed: number;
	due: number;
	error: string | null;
	error_kind: string | null;
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
			repository, started_at, finished_at, outcome, fetched, added, changed, closed, due,
			error, error_kind
		) VALUES (
			@repository, @started_at, @finished_at, @outcome, @fetched, @added, @changed, @closed,
			@due, @error, @error_kind
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
				error_kind: refresh.errorKind ?? null,
			});
			return {
				...refresh,
				id: Number(info.lastInsertRowid),
				error: refresh.error ?? null,
				errorKind: refresh.errorKind ?? null,
			};
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
			closed: row.closed,
			due: row.due,
		},
		error: row.error,
		errorKind: row.error_kind,
	};
}
