import type { Database, Statement } from "better-sqlite3";
import { fromBoolean, fromJson, toBoolean, toJson } from "./rows.js";
import {
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
	review_requested_from_user: number;
	created_at: string;
	updated_at: string;
	is_draft: number;
	labels: string;
	head_sha: string;
	base_ref: string;
	additions: number;
	deletions: number;
	changed_files: number;
	mergeable: string | null;
	review_decision: string | null;
	checks: string;
	last_activity_by: string | null;
	last_activity_at: string;
	closed_at: string | null;
	fetched_at: string;
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
			review_requested_from_user, created_at, updated_at, is_draft, labels, head_sha, base_ref,
			additions, deletions, changed_files, mergeable, review_decision, checks,
			last_activity_by, last_activity_at, closed_at, fetched_at
		) VALUES (
			@repository, @kind, @number, @title, @url, @author, @is_bot, @author_association,
			@authored_by_user,
			@review_requested_from_user, @created_at, @updated_at, @is_draft, @labels, @head_sha,
			@base_ref, @additions, @deletions, @changed_files, @mergeable, @review_decision, @checks,
			@last_activity_by, @last_activity_at, NULL, @fetched_at
		)
		ON CONFLICT (repository, kind, number) DO UPDATE SET
			title = excluded.title,
			url = excluded.url,
			author = excluded.author,
			is_bot = excluded.is_bot,
			author_association = excluded.author_association,
			authored_by_user = excluded.authored_by_user,
			review_requested_from_user = excluded.review_requested_from_user,
			created_at = excluded.created_at,
			updated_at = excluded.updated_at,
			is_draft = excluded.is_draft,
			labels = excluded.labels,
			head_sha = excluded.head_sha,
			base_ref = excluded.base_ref,
			additions = excluded.additions,
			deletions = excluded.deletions,
			changed_files = excluded.changed_files,
			mergeable = excluded.mergeable,
			review_decision = excluded.review_decision,
			checks = excluded.checks,
			last_activity_by = excluded.last_activity_by,
			last_activity_at = excluded.last_activity_at,
			closed_at = NULL,
			fetched_at = excluded.fetched_at
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

function toRow(facts: ItemFacts, fetchedAt: string): Record<string, unknown> {
	return {
		repository: facts.repository,
		kind: facts.kind,
		number: facts.number,
		title: facts.title,
		url: facts.url,
		author: facts.author,
		is_bot: fromBoolean(facts.isBot),
		author_association: facts.authorAssociation,
		authored_by_user: fromBoolean(facts.authoredByUser),
		review_requested_from_user: fromBoolean(facts.reviewRequestedFromUser),
		created_at: facts.createdAt,
		updated_at: facts.updatedAt,
		is_draft: fromBoolean(facts.isDraft),
		labels: toJson(facts.labels),
		head_sha: facts.headSha,
		base_ref: facts.baseRef,
		additions: facts.additions,
		deletions: facts.deletions,
		changed_files: facts.changedFiles,
		mergeable: facts.mergeable,
		review_decision: facts.reviewDecision,
		checks: toJson(facts.checks),
		last_activity_by: facts.lastActivityBy,
		last_activity_at: facts.lastActivityAt,
		fetched_at: fetchedAt,
	};
}

function fromRow(row: ItemDbRow): StoredItem {
	return {
		repository: row.repository,
		kind: row.kind as ItemKind,
		number: row.number,
		title: row.title,
		url: row.url,
		author: row.author,
		isBot: toBoolean(row.is_bot),
		authorAssociation: row.author_association,
		authoredByUser: toBoolean(row.authored_by_user),
		reviewRequestedFromUser: toBoolean(row.review_requested_from_user),
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		isDraft: toBoolean(row.is_draft),
		labels: fromJson<string[]>(row.labels, []),
		headSha: row.head_sha,
		baseRef: row.base_ref,
		additions: row.additions,
		deletions: row.deletions,
		changedFiles: row.changed_files,
		mergeable: row.mergeable,
		reviewDecision: row.review_decision,
		checks: fromJson<ChecksSummary>(row.checks, {
			state: "none",
			passed: 0,
			failed: 0,
			pending: 0,
		}),
		lastActivityBy: row.last_activity_by,
		lastActivityAt: row.last_activity_at,
		closedAt: row.closed_at,
		fetchedAt: row.fetched_at,
	};
}
