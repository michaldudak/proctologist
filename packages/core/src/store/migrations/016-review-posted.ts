/**
 * When the user posted a review draft on GitHub, so the panel says so and does not offer to post
 * it again. Null on a draft that has only ever been read here.
 */
export const sql = `
ALTER TABLE review_drafts ADD COLUMN posted_at TEXT;
`;
