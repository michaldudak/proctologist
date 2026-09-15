/**
 * The thumbs on an issue. GitHub calls them reactions and has eight; these are the two a
 * maintainer reads as a vote when deciding what is worth doing.
 */
export const sql = `
ALTER TABLE items ADD COLUMN upvotes INTEGER;
ALTER TABLE items ADD COLUMN downvotes INTEGER;
`;
