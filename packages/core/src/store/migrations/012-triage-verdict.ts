/**
 * What only a triage verdict carries: the kind of thing an issue is, and the issues it may be a
 * duplicate of. Both are null on a pull request's assessment.
 */
export const sql = `
ALTER TABLE assessments ADD COLUMN type TEXT;
ALTER TABLE assessments ADD COLUMN possible_duplicate_of TEXT;
`;
