/**
 * A refresh no longer assesses; it only fetches. The assessment counts leave the refresh record,
 * which now says how many pull requests the refresh found due instead, and a job can record which
 * job queued it, so the assessment a refresh starts can be traced back to that refresh.
 */
export const sql = `
ALTER TABLE refreshes DROP COLUMN reassessed;
ALTER TABLE refreshes DROP COLUMN unassessed;
ALTER TABLE refreshes ADD COLUMN due INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN parent_id TEXT;
`;
