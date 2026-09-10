import { sql as initial } from "./001-initial.js";
import { sql as refreshErrorKind } from "./002-refresh-error-kind.js";
import { sql as agent } from "./003-agent.js";
import { sql as refreshAssessmentSplit } from "./004-refresh-assessment-split.js";
import { sql as area } from "./005-area.js";
import { sql as priority } from "./006-priority.js";
import { sql as analyses } from "./007-analyses.js";
import { sql as authorAssociation } from "./008-author-association.js";

export interface Migration {
	id: number;
	name: string;
	sql: string;
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
];
