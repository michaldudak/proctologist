/**
 * Issues join pull requests in one table (ADR 0008). The rename runs with foreign keys on so SQLite
 * rewrites the REFERENCES clauses of assessments, notes, snoozes and review drafts for us; relaxing
 * the pull-request-only columns to nullable needs a table rebuild and so waits for migration 010.
 */
export const sql = `
ALTER TABLE pull_requests RENAME TO items;
`;
