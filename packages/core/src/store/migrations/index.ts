import { sql as initial } from "./001-initial.js";

export interface Migration {
	id: number;
	name: string;
	sql: string;
}

/**
 * Numbered migrations, applied in order and recorded in `schema_migrations`. They are TypeScript
 * modules rather than `.sql` files so the Electron bundle needs no asset copying step.
 */
export const migrations: Migration[] = [{ id: 1, name: "initial", sql: initial }];
