import type { Database } from "better-sqlite3";
import { fromJson, toJson } from "./rows.js";
import {
	resolveRef,
	type ItemKind,
	type ItemRef,
	type NewReviewDraft,
	type ReviewDraft,
	type ReviewFinding,
} from "./types.js";

interface ReviewDraftRow {
	id: number;
	repository: string;
	kind: string;
	number: number;
	head_sha: string;
	summary: string;
	verdict: string;
	findings: string;
	session_id: string | null;
	model: string | null;
	created_at: string;
}

export interface ReviewDraftRepository {
	add: (draft: NewReviewDraft, now: string) => ReviewDraft;
	latest: (ref: ItemRef) => ReviewDraft | undefined;
	/** Newest first. */
	history: (ref: ItemRef, limit?: number) => ReviewDraft[];
}

export function createReviewDraftRepository(db: Database): ReviewDraftRepository {
	const insert = db.prepare(`
		INSERT INTO review_drafts (
			repository, kind, number, head_sha, summary, verdict, findings, session_id, model, created_at
		) VALUES (
			@repository, @kind, @number, @head_sha, @summary, @verdict, @findings, @session_id, @model,
			@created_at
		)
	`);
	const selectHistory = db.prepare(`
		SELECT * FROM review_drafts
		WHERE repository = ? AND kind = ? AND number = ?
		ORDER BY id DESC
		LIMIT ?
	`);

	return {
		add: (draft, now) => {
			const key = resolveRef(draft);
			const createdAt = draft.createdAt ?? now;
			const info = insert.run({
				...key,
				head_sha: draft.headSha,
				summary: draft.summary,
				verdict: draft.verdict,
				findings: toJson(draft.findings),
				session_id: draft.sessionId,
				model: draft.model ?? null,
				created_at: createdAt,
			});

			return {
				...key,
				id: Number(info.lastInsertRowid),
				headSha: draft.headSha,
				summary: draft.summary,
				verdict: draft.verdict,
				findings: draft.findings,
				sessionId: draft.sessionId,
				model: draft.model ?? null,
				createdAt,
			};
		},
		latest: (ref) => {
			const key = resolveRef(ref);
			const row = selectHistory.get(key.repository, key.kind, key.number, 1) as
				ReviewDraftRow | undefined;
			return row ? fromRow(row) : undefined;
		},
		history: (ref, limit = 20) => {
			const key = resolveRef(ref);
			return (
				selectHistory.all(key.repository, key.kind, key.number, limit) as ReviewDraftRow[]
			).map(fromRow);
		},
	};
}

function fromRow(row: ReviewDraftRow): ReviewDraft {
	return {
		id: row.id,
		repository: row.repository,
		kind: row.kind as ItemKind,
		number: row.number,
		headSha: row.head_sha,
		summary: row.summary,
		verdict: row.verdict,
		findings: fromJson<ReviewFinding[]>(row.findings, []),
		sessionId: row.session_id,
		model: row.model,
		createdAt: row.created_at,
	};
}
