/**
 * The columns only an issue has, and `changed_at`: when the item last moved in a way that could
 * change a judgment. For a pull request that is GitHub's `updated_at`, which is what the backfill
 * sets; for an issue it is computed at fetch time, because an issue's `updated_at` moves for
 * labels, assignees and reactions and would otherwise leave every issue permanently due.
 */
export const sql = `
ALTER TABLE items ADD COLUMN changed_at TEXT NOT NULL DEFAULT '';
UPDATE items SET changed_at = updated_at;

ALTER TABLE items ADD COLUMN assignees TEXT;
ALTER TABLE items ADD COLUMN milestone TEXT;
ALTER TABLE items ADD COLUMN comments INTEGER;
ALTER TABLE items ADD COLUMN linked_pull_requests TEXT;
ALTER TABLE items ADD COLUMN state_reason TEXT;
`;
