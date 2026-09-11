/**
 * What only a triage verdict carries: the issues this one may be a duplicate of. Null on a pull
 * request's assessment.
 */
export const sql = `
ALTER TABLE assessments ADD COLUMN possible_duplicate_of TEXT;
`;
