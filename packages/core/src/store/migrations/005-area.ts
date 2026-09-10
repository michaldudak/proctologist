/**
 * "Category" became "area": the same eight values, under the name the UI and the prompt now use.
 * Stored assessments keep their values; only the column changes.
 */
export const sql = `
ALTER TABLE assessments RENAME COLUMN category TO area;
`;
