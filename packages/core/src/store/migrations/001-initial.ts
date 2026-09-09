/**
 * Every item-scoped table is keyed by repository, kind and number so issues can join the model
 * without a migration (ADR 0004). Timestamps are ISO-8601 UTC strings: sortable and readable in a
 * SQLite browser, which matters more here than a few bytes.
 */
export const sql = `
CREATE TABLE pull_requests (
	repository TEXT NOT NULL,
	kind TEXT NOT NULL,
	number INTEGER NOT NULL,
	title TEXT NOT NULL,
	url TEXT NOT NULL,
	author TEXT NOT NULL,
	is_bot INTEGER NOT NULL,
	authored_by_user INTEGER NOT NULL,
	review_requested_from_user INTEGER NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	is_draft INTEGER NOT NULL,
	labels TEXT NOT NULL,
	head_sha TEXT NOT NULL,
	base_ref TEXT NOT NULL,
	additions INTEGER NOT NULL,
	deletions INTEGER NOT NULL,
	changed_files INTEGER NOT NULL,
	mergeable TEXT,
	review_decision TEXT,
	checks TEXT NOT NULL,
	last_activity_by TEXT,
	last_activity_at TEXT NOT NULL,
	closed_at TEXT,
	fetched_at TEXT NOT NULL,
	PRIMARY KEY (repository, kind, number)
) STRICT;

CREATE INDEX pull_requests_by_repository ON pull_requests (repository, kind, closed_at);

CREATE TABLE assessments (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	repository TEXT NOT NULL,
	kind TEXT NOT NULL,
	number INTEGER NOT NULL,
	depth TEXT NOT NULL,
	head_sha TEXT NOT NULL,
	updated_at_seen TEXT NOT NULL,
	next_action TEXT,
	next_action_reason TEXT,
	category TEXT,
	relevance TEXT,
	relevance_reason TEXT,
	status TEXT,
	status_reason TEXT,
	effort TEXT,
	effort_reason TEXT,
	summary TEXT,
	confidence REAL,
	evidence TEXT,
	model TEXT,
	duration_ms INTEGER,
	error TEXT,
	created_at TEXT NOT NULL,
	FOREIGN KEY (repository, kind, number)
		REFERENCES pull_requests (repository, kind, number) ON DELETE CASCADE
) STRICT;

CREATE INDEX assessments_by_item ON assessments (repository, kind, number, id DESC);

CREATE TABLE notes (
	repository TEXT NOT NULL,
	kind TEXT NOT NULL,
	number INTEGER NOT NULL,
	text TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (repository, kind, number),
	FOREIGN KEY (repository, kind, number)
		REFERENCES pull_requests (repository, kind, number) ON DELETE CASCADE
) STRICT;

CREATE TABLE snoozes (
	repository TEXT NOT NULL,
	kind TEXT NOT NULL,
	number INTEGER NOT NULL,
	until_assessment_id INTEGER,
	until_date TEXT,
	created_at TEXT NOT NULL,
	PRIMARY KEY (repository, kind, number),
	FOREIGN KEY (repository, kind, number)
		REFERENCES pull_requests (repository, kind, number) ON DELETE CASCADE
) STRICT;

CREATE TABLE review_drafts (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	repository TEXT NOT NULL,
	kind TEXT NOT NULL,
	number INTEGER NOT NULL,
	head_sha TEXT NOT NULL,
	summary TEXT NOT NULL,
	verdict TEXT NOT NULL,
	findings TEXT NOT NULL,
	session_id TEXT,
	model TEXT,
	created_at TEXT NOT NULL,
	FOREIGN KEY (repository, kind, number)
		REFERENCES pull_requests (repository, kind, number) ON DELETE CASCADE
) STRICT;

CREATE INDEX review_drafts_by_item ON review_drafts (repository, kind, number, id DESC);

CREATE TABLE jobs (
	id TEXT PRIMARY KEY,
	kind TEXT NOT NULL,
	repository TEXT NOT NULL,
	item_kind TEXT,
	number INTEGER,
	state TEXT NOT NULL,
	progress TEXT,
	error TEXT,
	-- Set by whichever process the user asked to stop the job; the process running it polls this.
	abort_requested INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	started_at TEXT,
	finished_at TEXT
) STRICT;

CREATE INDEX jobs_by_state ON jobs (state, created_at);

-- One refresh per repository at a time, enforced by the database so the app and the CLI cannot
-- both start one.
CREATE UNIQUE INDEX jobs_one_active_refresh ON jobs (repository)
	WHERE kind = 'refresh' AND state IN ('queued', 'running');

CREATE TABLE refreshes (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	repository TEXT NOT NULL,
	started_at TEXT NOT NULL,
	finished_at TEXT NOT NULL,
	outcome TEXT NOT NULL,
	fetched INTEGER NOT NULL,
	added INTEGER NOT NULL,
	changed INTEGER NOT NULL,
	reassessed INTEGER NOT NULL,
	unassessed INTEGER NOT NULL,
	closed INTEGER NOT NULL,
	error TEXT
) STRICT;

CREATE INDEX refreshes_by_repository ON refreshes (repository, id DESC);
`;
