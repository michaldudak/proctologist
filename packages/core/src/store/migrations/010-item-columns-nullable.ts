/**
 * The pull-request-only columns become nullable so an issue can leave them empty (ADR 0008). SQLite
 * cannot relax a constraint in place, so the table is rebuilt: create, copy, drop, rename. It runs
 * with foreign keys off, which is what makes dropping the old table safe — with them on, DROP TABLE
 * performs an implicit delete that would cascade through every assessment, note, snooze and review
 * draft. The runner checks `foreign_key_check` afterwards.
 */
export const sql = `
CREATE TABLE items_new (
	repository TEXT NOT NULL,
	kind TEXT NOT NULL,
	number INTEGER NOT NULL,
	title TEXT NOT NULL,
	url TEXT NOT NULL,
	author TEXT NOT NULL,
	is_bot INTEGER NOT NULL,
	author_association TEXT NOT NULL DEFAULT 'NONE',
	authored_by_user INTEGER NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	labels TEXT NOT NULL,
	last_activity_by TEXT,
	last_activity_at TEXT NOT NULL,
	closed_at TEXT,
	fetched_at TEXT NOT NULL,
	-- Pull requests only; null on an issue.
	review_requested_from_user INTEGER,
	is_draft INTEGER,
	head_sha TEXT,
	base_ref TEXT,
	additions INTEGER,
	deletions INTEGER,
	changed_files INTEGER,
	mergeable TEXT,
	review_decision TEXT,
	checks TEXT,
	PRIMARY KEY (repository, kind, number)
) STRICT;

INSERT INTO items_new (
	repository, kind, number, title, url, author, is_bot, author_association, authored_by_user,
	created_at, updated_at, labels, last_activity_by, last_activity_at, closed_at, fetched_at,
	review_requested_from_user, is_draft, head_sha, base_ref, additions, deletions, changed_files,
	mergeable, review_decision, checks
)
SELECT
	repository, kind, number, title, url, author, is_bot, author_association, authored_by_user,
	created_at, updated_at, labels, last_activity_by, last_activity_at, closed_at, fetched_at,
	review_requested_from_user, is_draft, head_sha, base_ref, additions, deletions, changed_files,
	mergeable, review_decision, checks
FROM items;

DROP TABLE items;

ALTER TABLE items_new RENAME TO items;

CREATE INDEX items_by_repository ON items (repository, kind, closed_at);
`;
