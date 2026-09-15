/**
 * Which verdict a posted draft actually went up with. The user may overrule the agent's at the
 * moment of posting, and the panel should say what GitHub was told rather than what was drafted.
 */
export const sql = `
ALTER TABLE review_drafts ADD COLUMN posted_as TEXT;
`;
