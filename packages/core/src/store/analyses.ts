import type { Database } from "better-sqlite3";
import type { AgentKind } from "../agents/types.js";
import { resolveRef, type Analysis, type ItemKind, type ItemRef } from "./types.js";

interface AnalysisRow {
	assessment_id: number;
	markdown: string;
	repository: string;
	kind: string;
	number: number;
	head_sha: string;
	agent: string | null;
	model: string | null;
	created_at: string;
}

export interface AnalysisRepository {
	/** One per assessment, written right after the assessment it explains. */
	add: (assessmentId: number, markdown: string) => Analysis;
	get: (assessmentId: number) => Analysis | undefined;
	/** The newest analysis of an item, whether or not its assessment is still the current one. */
	latest: (ref: ItemRef) => Analysis | undefined;
	/** Whether any analysis of an item exists, without reading it: a row only needs to know. */
	has: (ref: ItemRef) => boolean;
}

const SELECT = `
	SELECT x.assessment_id, x.markdown, a.repository, a.kind, a.number, a.head_sha, a.agent,
		a.model, a.created_at
	FROM analyses x
	JOIN assessments a ON a.id = x.assessment_id
`;

export function createAnalysisRepository(db: Database): AnalysisRepository {
	const insert = db.prepare(`INSERT INTO analyses (assessment_id, markdown) VALUES (?, ?)`);
	const selectOne = db.prepare(`${SELECT} WHERE x.assessment_id = ?`);
	const selectLatest = db.prepare(`
		${SELECT}
		WHERE a.repository = ? AND a.kind = ? AND a.number = ?
		ORDER BY x.assessment_id DESC
		LIMIT 1
	`);

	const selectExists = db.prepare(`
		SELECT 1
		FROM analyses x
		JOIN assessments a ON a.id = x.assessment_id
		WHERE a.repository = ? AND a.kind = ? AND a.number = ?
		LIMIT 1
	`);

	const get = (assessmentId: number): Analysis | undefined => {
		const row = selectOne.get(assessmentId) as AnalysisRow | undefined;
		return row ? fromRow(row) : undefined;
	};

	return {
		add: (assessmentId, markdown) => {
			insert.run(assessmentId, markdown);
			const analysis = get(assessmentId);
			if (!analysis) {
				throw new Error(`Assessment ${String(assessmentId)} vanished while its analysis was kept.`);
			}
			return analysis;
		},
		get,
		latest: (ref) => {
			const key = resolveRef(ref);
			const row = selectLatest.get(key.repository, key.kind, key.number) as AnalysisRow | undefined;
			return row ? fromRow(row) : undefined;
		},
		has: (ref) => {
			const key = resolveRef(ref);
			return selectExists.get(key.repository, key.kind, key.number) !== undefined;
		},
	};
}

function fromRow(row: AnalysisRow): Analysis {
	return {
		assessmentId: row.assessment_id,
		markdown: row.markdown,
		repository: row.repository,
		kind: row.kind as ItemKind,
		number: row.number,
		headSha: row.head_sha,
		agent: row.agent as AgentKind | null,
		model: row.model,
		createdAt: row.created_at,
	};
}
