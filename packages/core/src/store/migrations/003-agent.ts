/**
 * Records which agent produced an assessment or a review draft, not just which model. With more
 * than one agent in play, "opus at high effort" and "gpt-5.1 at high effort" are only telling
 * apart by the agent that ran them.
 */
export const sql = `
ALTER TABLE assessments ADD COLUMN agent TEXT;
ALTER TABLE review_drafts ADD COLUMN agent TEXT;
`;
