import type { Database } from "better-sqlite3";
import { fromJson, toJson } from "./rows.js";
import {
	resolveRef,
	type Assessment,
	type AssessmentDepth,
	type Effort,
	type Evidence,
	type ItemKind,
	type ItemRef,
	type NewAssessment,
	type NextAction,
} from "./types.js";

interface AssessmentRow {
	id: number;
	repository: string;
	kind: string;
	number: number;
	depth: string;
	head_sha: string;
	updated_at_seen: string;
	next_action: string | null;
	next_action_reason: string | null;
	category: string | null;
	relevance: string | null;
	relevance_reason: string | null;
	status: string | null;
	status_reason: string | null;
	effort: string | null;
	effort_reason: string | null;
	summary: string | null;
	confidence: number | null;
	evidence: string | null;
	model: string | null;
	duration_ms: number | null;
	error: string | null;
	created_at: string;
}

export interface OutdatedOptions {
	/** An assessment older than this is re-run even when nothing about the item changed. */
	outdatedAfterDays: number;
	now: string;
	kind?: ItemKind;
}

export interface AssessmentRepository {
	/** Assessments are append-only; the newest one for an item is the current one. */
	add: (assessment: NewAssessment, now: string) => Assessment;
	current: (ref: ItemRef) => Assessment | undefined;
	/** The current assessment of every item in the repository that has one. */
	currentForRepository: (repository: string, kind?: ItemKind) => Assessment[];
	/** Newest first. */
	history: (ref: ItemRef, limit?: number) => Assessment[];
	/** The assessment the current one replaced, for spotting what changed. */
	previous: (ref: ItemRef) => Assessment | undefined;
	/**
	 * Numbers of open items whose assessment is missing, outdated, older than the cut-off, or
	 * failed. This is what a refresh feeds to Codex.
	 */
	outdated: (repository: string, options: OutdatedOptions) => number[];
}

const CURRENT_ASSESSMENTS = `
	SELECT a.* FROM assessments a
	JOIN (
		SELECT repository, kind, number, MAX(id) AS id
		FROM assessments GROUP BY repository, kind, number
	) newest ON newest.id = a.id
`;

export function createAssessmentRepository(db: Database): AssessmentRepository {
	const insert = db.prepare(`
		INSERT INTO assessments (
			repository, kind, number, depth, head_sha, updated_at_seen, next_action,
			next_action_reason, category, relevance, relevance_reason, status, status_reason,
			effort, effort_reason, summary, confidence, evidence, model, duration_ms, error, created_at
		) VALUES (
			@repository, @kind, @number, @depth, @head_sha, @updated_at_seen, @next_action,
			@next_action_reason, @category, @relevance, @relevance_reason, @status, @status_reason,
			@effort, @effort_reason, @summary, @confidence, @evidence, @model, @duration_ms, @error,
			@created_at
		)
	`);

	const selectHistory = db.prepare(`
		SELECT * FROM assessments
		WHERE repository = ? AND kind = ? AND number = ?
		ORDER BY id DESC
		LIMIT ?
	`);

	const selectCurrentForRepository = db.prepare(`
		${CURRENT_ASSESSMENTS}
		WHERE a.repository = ? AND a.kind = ?
		ORDER BY a.number DESC
	`);

	const selectOutdated = db.prepare(`
		WITH current AS (${CURRENT_ASSESSMENTS})
		SELECT p.number FROM pull_requests p
		LEFT JOIN current c
			ON c.repository = p.repository AND c.kind = p.kind AND c.number = p.number
		WHERE p.repository = @repository AND p.kind = @kind AND p.closed_at IS NULL
			AND (
				c.id IS NULL
				OR c.error IS NOT NULL
				OR c.head_sha <> p.head_sha
				OR c.updated_at_seen <> p.updated_at
				OR c.created_at < @cutoff
			)
		ORDER BY p.number
	`);

	return {
		add: (assessment, now) => {
			const key = resolveRef(assessment);
			const createdAt = assessment.createdAt ?? now;
			const verdict = assessment.verdict;
			const info = insert.run({
				repository: key.repository,
				kind: key.kind,
				number: key.number,
				depth: assessment.depth,
				head_sha: assessment.headSha,
				updated_at_seen: assessment.updatedAtSeen,
				next_action: verdict?.nextAction ?? null,
				next_action_reason: verdict?.nextActionReason ?? null,
				category: verdict?.category ?? null,
				relevance: verdict?.relevance ?? null,
				relevance_reason: verdict?.relevanceReason ?? null,
				status: verdict?.status ?? null,
				status_reason: verdict?.statusReason ?? null,
				effort: verdict?.effort ?? null,
				effort_reason: verdict?.effortReason ?? null,
				summary: verdict?.summary ?? null,
				confidence: verdict?.confidence ?? null,
				evidence: verdict ? toJson(verdict.evidence) : null,
				model: assessment.model ?? null,
				duration_ms: assessment.durationMs ?? null,
				error: assessment.error ?? null,
				created_at: createdAt,
			});

			return {
				...key,
				id: Number(info.lastInsertRowid),
				depth: assessment.depth,
				headSha: assessment.headSha,
				updatedAtSeen: assessment.updatedAtSeen,
				verdict: verdict ?? null,
				error: assessment.error ?? null,
				model: assessment.model ?? null,
				durationMs: assessment.durationMs ?? null,
				createdAt,
			};
		},
		current: (ref) => {
			const key = resolveRef(ref);
			const row = selectHistory.get(key.repository, key.kind, key.number, 1) as
				AssessmentRow | undefined;
			return row ? fromRow(row) : undefined;
		},
		currentForRepository: (repository, kind = "pull_request") =>
			(selectCurrentForRepository.all(repository, kind) as AssessmentRow[]).map(fromRow),
		history: (ref, limit = 20) => {
			const key = resolveRef(ref);
			return (
				selectHistory.all(key.repository, key.kind, key.number, limit) as AssessmentRow[]
			).map(fromRow);
		},
		previous: (ref) => {
			const key = resolveRef(ref);
			const rows = selectHistory.all(key.repository, key.kind, key.number, 2) as AssessmentRow[];
			const row = rows[1];
			return row ? fromRow(row) : undefined;
		},
		outdated: (repository, options) => {
			const cutoff = new Date(
				new Date(options.now).getTime() - options.outdatedAfterDays * 86_400_000,
			).toISOString();
			return (
				selectOutdated.all({
					repository,
					kind: options.kind ?? "pull_request",
					cutoff,
				}) as { number: number }[]
			).map((row) => row.number);
		},
	};
}

function fromRow(row: AssessmentRow): Assessment {
	return {
		id: row.id,
		repository: row.repository,
		kind: row.kind as ItemKind,
		number: row.number,
		depth: row.depth as AssessmentDepth,
		headSha: row.head_sha,
		updatedAtSeen: row.updated_at_seen,
		verdict:
			row.next_action === null
				? null
				: {
						nextAction: row.next_action as NextAction,
						nextActionReason: row.next_action_reason ?? "",
						category: row.category ?? "",
						relevance: row.relevance ?? "",
						relevanceReason: row.relevance_reason ?? "",
						status: row.status ?? "",
						statusReason: row.status_reason ?? "",
						effort: row.effort as Effort,
						effortReason: row.effort_reason ?? "",
						summary: row.summary ?? "",
						confidence: row.confidence ?? 0,
						evidence: fromJson<Evidence[]>(row.evidence, []),
					},
		error: row.error,
		model: row.model,
		durationMs: row.duration_ms,
		createdAt: row.created_at,
	};
}
