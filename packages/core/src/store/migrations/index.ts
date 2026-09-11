import { sql as initial } from "./001-initial.js";
import { sql as refreshErrorKind } from "./002-refresh-error-kind.js";
import { sql as agent } from "./003-agent.js";
import { sql as refreshAssessmentSplit } from "./004-refresh-assessment-split.js";
import { sql as area } from "./005-area.js";
import { sql as priority } from "./006-priority.js";
import { sql as analyses } from "./007-analyses.js";
import { sql as authorAssociation } from "./008-author-association.js";
import { sql as renameToItems } from "./009-rename-pull-requests-to-items.js";
import { sql as itemColumnsNullable } from "./010-item-columns-nullable.js";
import { sql as issueColumns } from "./011-issue-columns.js";
import { sql as triageVerdict } from "./012-triage-verdict.js";
import { sql as votes } from "./013-votes.js";

export interface Migration {
	id: number;
	name: string;
	sql: string;
	/**
	 * Set for a migration that rebuilds a table other tables reference. With foreign keys on, DROP
	 * TABLE performs an implicit delete that cascades into the children; the runner turns them off
	 * around the migration and runs `foreign_key_check` before committing to it.
	 */
	foreignKeys?: "off";
}

/**
 * Numbered migrations, applied in order and recorded in `schema_migrations`. They are TypeScript
 * modules rather than `.sql` files so the Electron bundle needs no asset copying step.
 */
export const migrations: Migration[] = [
	{ id: 1, name: "initial", sql: initial },
	{ id: 2, name: "refresh-error-kind", sql: refreshErrorKind },
	{ id: 3, name: "agent", sql: agent },
	{ id: 4, name: "refresh-assessment-split", sql: refreshAssessmentSplit },
	{ id: 5, name: "area", sql: area },
	{ id: 6, name: "priority", sql: priority },
	{ id: 7, name: "analyses", sql: analyses },
	{ id: 8, name: "author-association", sql: authorAssociation },
	{ id: 9, name: "rename-pull-requests-to-items", sql: renameToItems },
	{ id: 10, name: "item-columns-nullable", sql: itemColumnsNullable, foreignKeys: "off" },
	{ id: 11, name: "issue-columns", sql: issueColumns },
	{ id: 12, name: "triage-verdict", sql: triageVerdict },
	{ id: 13, name: "votes", sql: votes },
];
