/**
 * The author's relationship to the repository, as GitHub reports it: owner, member, collaborator,
 * contributor and so on. Rows fetched before it was recorded read `NONE` until the next refresh
 * fills it in.
 */
export const sql = `
ALTER TABLE pull_requests ADD COLUMN author_association TEXT NOT NULL DEFAULT 'NONE';
`;
