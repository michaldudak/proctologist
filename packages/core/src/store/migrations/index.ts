import { sql as initial } from "./001-initial.js";
import { sql as refreshErrorKind } from "./002-refresh-error-kind.js";
import { sql as agent } from "./003-agent.js";

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
];
