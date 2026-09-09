/**
 * Records why a refresh failed, not just what it said. The kind is what lets the app tell the user
 * whether trying again is likely to help.
 */
export const sql = `
ALTER TABLE refreshes ADD COLUMN error_kind TEXT;
`;
