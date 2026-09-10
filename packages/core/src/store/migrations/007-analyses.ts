/**
 * A thorough assessment now writes an analysis: a long-form Markdown explanation of the change,
 * with diagrams. It lives in its own table rather than as a column, because it can run to tens of
 * kilobytes and the list of current assessments must not drag every one of them along.
 */
export const sql = `
CREATE TABLE analyses (
	assessment_id INTEGER PRIMARY KEY REFERENCES assessments (id) ON DELETE CASCADE,
	markdown TEXT NOT NULL
) STRICT;
`;
