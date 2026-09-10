/**
 * The agent now judges how urgent and important each pull request is. Assessments made before it
 * did have no priority, and stay that way until the pull request is assessed again.
 */
export const sql = `
ALTER TABLE assessments ADD COLUMN priority TEXT;
ALTER TABLE assessments ADD COLUMN priority_reason TEXT;
`;
