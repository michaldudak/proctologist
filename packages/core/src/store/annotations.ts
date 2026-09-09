import type { Database } from "better-sqlite3";
import { resolveRef, type ItemKind, type ItemRef, type Note, type Snooze } from "./types.js";

interface NoteRow {
	repository: string;
	kind: string;
	number: number;
	text: string;
	updated_at: string;
}

interface SnoozeRow {
	repository: string;
	kind: string;
	number: number;
	until_assessment_id: number | null;
	until_date: string | null;
	created_at: string;
}

export interface NoteRepository {
	get: (ref: ItemRef) => Note | undefined;
	/** Setting empty text clears the note, so the UI needs no separate delete affordance. */
	set: (ref: ItemRef, text: string, now: string) => void;
	clear: (ref: ItemRef) => void;
	list: (repository: string, kind?: ItemKind) => Note[];
}

export interface SnoozeRepository {
	get: (ref: ItemRef) => Snooze | undefined;
	/** Hides the item until the given assessment stops being the current one. */
	untilAssessmentChanges: (ref: ItemRef, assessmentId: number, now: string) => void;
	untilDate: (ref: ItemRef, until: string, now: string) => void;
	clear: (ref: ItemRef) => void;
	list: (repository: string, kind?: ItemKind) => Snooze[];
}

export function createNoteRepository(db: Database): NoteRepository {
	const upsert = db.prepare(`
		INSERT INTO notes (repository, kind, number, text, updated_at)
		VALUES (@repository, @kind, @number, @text, @updated_at)
		ON CONFLICT (repository, kind, number)
		DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at
	`);
	const selectOne = db.prepare(
		"SELECT * FROM notes WHERE repository = ? AND kind = ? AND number = ?",
	);
	const selectAll = db.prepare(
		"SELECT * FROM notes WHERE repository = ? AND kind = ? ORDER BY number DESC",
	);
	const remove = db.prepare("DELETE FROM notes WHERE repository = ? AND kind = ? AND number = ?");

	const clear = (ref: ItemRef): void => {
		const key = resolveRef(ref);
		remove.run(key.repository, key.kind, key.number);
	};

	return {
		get: (ref) => {
			const key = resolveRef(ref);
			const row = selectOne.get(key.repository, key.kind, key.number) as NoteRow | undefined;
			return row ? toNote(row) : undefined;
		},
		set: (ref, text, now) => {
			if (text.trim() === "") {
				clear(ref);
				return;
			}
			const key = resolveRef(ref);
			upsert.run({ ...key, text, updated_at: now });
		},
		clear,
		list: (repository, kind = "pull_request") =>
			(selectAll.all(repository, kind) as NoteRow[]).map(toNote),
	};
}

export function createSnoozeRepository(db: Database): SnoozeRepository {
	const upsert = db.prepare(`
		INSERT INTO snoozes (repository, kind, number, until_assessment_id, until_date, created_at)
		VALUES (@repository, @kind, @number, @until_assessment_id, @until_date, @created_at)
		ON CONFLICT (repository, kind, number) DO UPDATE SET
			until_assessment_id = excluded.until_assessment_id,
			until_date = excluded.until_date,
			created_at = excluded.created_at
	`);
	const selectOne = db.prepare(
		"SELECT * FROM snoozes WHERE repository = ? AND kind = ? AND number = ?",
	);
	const selectAll = db.prepare(
		"SELECT * FROM snoozes WHERE repository = ? AND kind = ? ORDER BY number DESC",
	);
	const remove = db.prepare("DELETE FROM snoozes WHERE repository = ? AND kind = ? AND number = ?");

	return {
		get: (ref) => {
			const key = resolveRef(ref);
			const row = selectOne.get(key.repository, key.kind, key.number) as SnoozeRow | undefined;
			return row ? toSnooze(row) : undefined;
		},
		untilAssessmentChanges: (ref, assessmentId, now) => {
			upsert.run({
				...resolveRef(ref),
				until_assessment_id: assessmentId,
				until_date: null,
				created_at: now,
			});
		},
		untilDate: (ref, until, now) => {
			upsert.run({
				...resolveRef(ref),
				until_assessment_id: null,
				until_date: until,
				created_at: now,
			});
		},
		clear: (ref) => {
			const key = resolveRef(ref);
			remove.run(key.repository, key.kind, key.number);
		},
		list: (repository, kind = "pull_request") =>
			(selectAll.all(repository, kind) as SnoozeRow[]).map(toSnooze),
	};
}

function toNote(row: NoteRow): Note {
	return {
		repository: row.repository,
		kind: row.kind as ItemKind,
		number: row.number,
		text: row.text,
		updatedAt: row.updated_at,
	};
}

function toSnooze(row: SnoozeRow): Snooze {
	return {
		repository: row.repository,
		kind: row.kind as ItemKind,
		number: row.number,
		untilAssessmentId: row.until_assessment_id,
		untilDate: row.until_date,
		createdAt: row.created_at,
	};
}
