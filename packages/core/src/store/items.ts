import type { Database, Statement } from "better-sqlite3";
import { fromBoolean, fromJson, toBoolean, toJson } from "./rows.js";
import {
	ISSUE,
	isIssue,
	PULL_REQUEST,
	resolveRef,
	type ChecksSummary,
	type ItemKind,
	type ItemRef,
	type ItemFacts,
	type StoredItem,
} from "./types.js";

interface ItemDbRow {
	repository: string;
	kind: string;
	number: number;
	title: string;
	url: string;
	author: string;
	is_bot: number;
	author_association: string;
	authored_by_user: number;
	created_at: string;
	updated_at: string;
	changed_at: string;
	labels: string;
	last_activity_by: string | null;
	last_activity_at: string;
	closed_at: string | null;
	fetched_at: string;
	review_requested_from_user: number | null;
	is_draft: number | null;
	head_sha: string | null;
	base_ref: string | null;
	additions: number | null;
	deletions: number | null;
	changed_files: number | null;
	mergeable: string | null;
	review_decision: string | null;
	checks: string | null;
	assignees: string | null;
	milestone: string | null;
	comments: number | null;
	linked_pull_requests: string | null;
	state_reason: string | null;
}

export interface ListItemsOptions {
	/** Which kind to list. One table holds both (ADR 0008), so every read has to say. */
	kind?: ItemKind;
	/** Closed items are kept for a while but hidden unless asked for. */
	includeClosed?: boolean;
}

export interface PurgeOptions {
	/** Closed before this instant. */
	before: string;
}

export interface ItemRepository {
	/** Records the facts of one item as last fetched, clearing any earlier `closed_at`. */
	upsert: (facts: ItemFacts, fetchedAt: string) => void;
	upsertMany: (facts: ItemFacts[], fetchedAt: string) => void;
	get: (ref: ItemRef) => StoredItem | undefined;
	list: (repository: string, options?: ListItemsOptions) => StoredItem[];
	openNumbers: (repository: string, kind?: ItemKind) => number[];
	/** Marks everything open in the repository that is not in `openNumbers` as closed. */
	closeMissing: (
		repository: string,
		openNumbers: number[],
		closedAt: string,
		kind?: ItemKind,
	) => number[];
	/** Deletes closed items of every kind, and their assessments, unless the user left a note. */
	purgeClosed: (repository: string, options: PurgeOptions) => number;
}

export function createItemRepository(db: Database): ItemRepository {
	const upsert: Statement = db.prepare(`
		INSERT INTO items (
			repository, kind, number, title, url, author, is_bot, author_association, authored_by_user,
			created_at, updated_at, changed_at, labels, last_activity_by, last_activity_at, closed_at,
			fetched_at,
			review_requested_from_user, is_draft, head_sha, base_ref, additions, deletions,
			changed_files, mergeable, review_decision, checks,
			assignees, milestone, comments, linked_pull_requests, state_reason
		) VALUES (
			@repository, @kind, @number, @title, @url, @author, @is_bot, @author_association,
			@authored_by_user,
			@created_at, @updated_at, @changed_at, @labels, @last_activity_by, @last_activity_at, NULL,
			@fetched_at,
			@review_requested_from_user, @is_draft, @head_sha, @base_ref, @additions, @deletions,
			@changed_files, @mergeable, @review_decision, @checks,
			@assignees, @milestone, @comments, @linked_pull_requests, @state_reason
		)
		ON CONFLICT (repository, kind, number) DO UPDATE SET
			title = excluded.title,
			url = excluded.url,
			author = excluded.author,
			is_bot = excluded.is_bot,
			author_association = excluded.author_association,
			authored_by_user = excluded.authored_by_user,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at,
			changed_at = excluded.changed_at,
			labels = excluded.labels,
			last_activity_by = excluded.last_activity_by,
			last_activity_at = excluded.last_activity_at,
			closed_at = NULL,
			fetched_at = excluded.fetched_at,
			review_requested_from_user = excluded.review_requested_from_user,
			is_draft = excluded.is_draft,
			head_sha = excluded.head_sha,
			base_ref = excluded.base_ref,
			additions = excluded.additions,
			deletions = excluded.deletions,
			changed_files = excluded.changed_files,
			mergeable = excluded.mergeable,
			review_decision = excluded.review_decision,
			checks = excluded.checks,
			assignees = excluded.assignees,
			milestone = excluded.milestone,
			comments = excluded.comments,
			linked_pull_requests = excluded.linked_pull_requests,
			state_reason = excluded.state_reason
	`);

	const selectOne = db.prepare(
		"SELECT * FROM items WHERE repository = ? AND kind = ? AND number = ?",
	);
	// Both kinds share the table, so these filter on kind. They did not have to before, and did not.
	const selectOpen = db.prepare(
		"SELECT * FROM items WHERE repository = ? AND kind = ? AND closed_at IS NULL ORDER BY number DESC",
	);
	const selectAll = db.prepare(
		"SELECT * FROM items WHERE repository = ? AND kind = ? ORDER BY number DESC",
	);
	const selectOpenNumbers = db.prepare(
		"SELECT number FROM items WHERE repository = ? AND kind = ? AND closed_at IS NULL",
	);
	const close = db.prepare(
		"UPDATE items SET closed_at = ? WHERE repository = ? AND kind = ? AND number = ?",
	);
	const purge = db.prepare(`
		DELETE FROM items
		WHERE repository = @repository
			AND closed_at IS NOT NULL
			AND closed_at < @before
			AND NOT EXISTS (
				SELECT 1 FROM notes
				WHERE notes.repository = items.repository
					AND notes.kind = items.kind
					AND notes.number = items.number
			)
	`);

	const upsertMany = db.transaction((rows: ItemFacts[], fetchedAt: string) => {
		for (const facts of rows) {
			upsert.run(toRow(facts, fetchedAt));
		}
	});

	return {
		upsert: (facts, fetchedAt) => {
			upsert.run(toRow(facts, fetchedAt));
		},
		upsertMany: (rows, fetchedAt) => {
			upsertMany(rows, fetchedAt);
		},
		get: (ref) => {
			const key = resolveRef(ref);
			const row = selectOne.get(key.repository, key.kind, key.number) as ItemDbRow | undefined;
			return row ? fromRow(row) : undefined;
		},
		list: (repository, options) => {
			const statement = options?.includeClosed ? selectAll : selectOpen;
			const kind = options?.kind ?? PULL_REQUEST;
			return (statement.all(repository, kind) as ItemDbRow[]).map(fromRow);
		},
		openNumbers: (repository, kind = "pull_request") =>
			(selectOpenNumbers.all(repository, kind) as { number: number }[]).map((row) => row.number),
		closeMissing: (repository, openNumbers, closedAt, kind = "pull_request") => {
			const open = new Set(openNumbers);
			const stored = (selectOpenNumbers.all(repository, kind) as { number: number }[]).map(
				(row) => row.number,
			);
			const missing = stored.filter((number) => !open.has(number));
			for (const number of missing) {
				close.run(closedAt, repository, kind, number);
			}
			return missing;
		},
		purgeClosed: (repository, options) => purge.run({ repository, before: options.before }).changes,
	};
}

const NO_CHECKS: ChecksSummary = { state: "none", passed: 0, failed: 0, pending: 0 };

function toRow(facts: ItemFacts, fetchedAt: string): Record<string, unknown> {
	const common = {
		repository: facts.repository,
		kind: facts.kind,
		number: facts.number,
		title: facts.title,
		url: facts.url,
		author: facts.author,
		is_bot: fromBoolean(facts.isBot),
		author_association: facts.authorAssociation,
		authored_by_user: fromBoolean(facts.authoredByUser),
		created_at: facts.createdAt,
		updated_at: facts.updatedAt,
		changed_at: facts.changedAt,
		labels: toJson(facts.labels),
		last_activity_by: facts.lastActivityBy,
		last_activity_at: facts.lastActivityAt,
		fetched_at: fetchedAt,
	};
	// Every column of both kinds has to be bound, so the half that does not apply is bound to null.
	const empty = {
		review_requested_from_user: null,
		is_draft: null,
		head_sha: null,
		base_ref: null,
		additions: null,
		deletions: null,
		changed_files: null,
		mergeable: null,
		review_decision: null,
		checks: null,
		assignees: null,
		milestone: null,
		comments: null,
		linked_pull_requests: null,
		state_reason: null,
	};

	if (isIssue(facts)) {
		return {
			...common,
			...empty,
			assignees: toJson(facts.assignees),
			milestone: facts.milestone,
			comments: facts.comments,
			linked_pull_requests: toJson(facts.linkedPullRequests),
			state_reason: facts.stateReason,
		};
	}

	return {
		...common,
		...empty,
		review_requested_from_user: fromBoolean(facts.reviewRequestedFromUser),
		is_draft: fromBoolean(facts.isDraft),
		head_sha: facts.headSha,
		base_ref: facts.baseRef,
		additions: facts.additions,
		deletions: facts.deletions,
		changed_files: facts.changedFiles,
		mergeable: facts.mergeable,
		review_decision: facts.reviewDecision,
		checks: toJson(facts.checks),
	};
}

function fromRow(row: ItemDbRow): StoredItem {
	const common = {
		repository: row.repository,
		number: row.number,
		title: row.title,
		url: row.url,
		author: row.author,
		isBot: toBoolean(row.is_bot),
		authorAssociation: row.author_association,
		authoredByUser: toBoolean(row.authored_by_user),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		changedAt: row.changed_at,
		labels: fromJson<string[]>(row.labels, []),
		lastActivityBy: row.last_activity_by,
		lastActivityAt: row.last_activity_at,
		closedAt: row.closed_at,
		fetchedAt: row.fetched_at,
	};

	if (row.kind === ISSUE) {
		return {
			...common,
			kind: ISSUE,
			assignees: fromJson<string[]>(row.assignees ?? "[]", []),
			milestone: row.milestone,
			comments: row.comments ?? 0,
			linkedPullRequests: fromJson<number[]>(row.linked_pull_requests ?? "[]", []),
			stateReason: row.state_reason,
		};
	}

	return {
		...common,
		kind: PULL_REQUEST,
		reviewRequestedFromUser: toBoolean(row.review_requested_from_user ?? 0),
		isDraft: toBoolean(row.is_draft ?? 0),
		headSha: row.head_sha ?? "",
		baseRef: row.base_ref ?? "",
		additions: row.additions ?? 0,
		deletions: row.deletions ?? 0,
		changedFiles: row.changed_files ?? 0,
		mergeable: row.mergeable,
		reviewDecision: row.review_decision,
		checks: row.checks ? fromJson<ChecksSummary>(row.checks, NO_CHECKS) : NO_CHECKS,
	};
}
