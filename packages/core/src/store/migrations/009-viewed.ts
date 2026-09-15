/**
 * The user can mark an item as viewed. The mark records the last activity the user saw; it stops
 * counting once a refresh brings newer activity from another party. The pull request grows a
 * column that says whether its last activity came from the user, so the mark can tell the user's
 * own follow-up apart from someone else's. Rows fetched before the column existed hold 0 until
 * the next refresh.
 */
export const sql = `
CREATE TABLE viewed (
	repository TEXT NOT NULL,
	kind TEXT NOT NULL,
	number INTEGER NOT NULL,
	last_activity_at_seen TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (repository, kind, number),
	FOREIGN KEY (repository, kind, number)
		REFERENCES pull_requests (repository, kind, number) ON DELETE CASCADE
) STRICT;

ALTER TABLE pull_requests ADD COLUMN last_activity_by_user INTEGER NOT NULL DEFAULT 0;
`;
