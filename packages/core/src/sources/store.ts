import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { ItemRef } from "../store/types.js";
import type { Source, SourceItem, ItemState } from "./types.js";

const ITEM_SELECT = `SELECT i.id, i.source_id AS sourceId, s.provider, s.locator, i.kind,
 i.external_id AS externalId, i.title, i.url, i.state, i.outcome, i.available,
 i.verified_at AS verifiedAt, i.reopened_at AS reopenedAt FROM source_items i JOIN sources s ON s.id = i.source_id`;
function toItem(row: unknown): SourceItem | undefined {
	if (!row) return undefined;
	const item = row as Omit<SourceItem, "available"> & { available: number };
	return { ...item, available: item.available === 1 };
}
export interface SourceRepository {
	markUnavailable: (id: string) => void;
	recordState: (id: string, state: ItemState, at: string) => void;
	reconcile: (repositories: string[]) => void;
	list: () => Source[];
	items: (sourceId?: string) => SourceItem[];
	getItem: (id: string) => SourceItem | undefined;
	identify: (ref: ItemRef) => SourceItem | undefined;
}
export function createSourceRepository(db: Database): SourceRepository {
	return {
		reconcile: db.transaction((repositories: string[]) => {
			const names = new Set(repositories);
			for (const source of db
				.prepare("SELECT * FROM sources WHERE provider = 'github' AND active = 1")
				.all() as Source[]) {
				if (names.has(source.locator)) continue;
				db.prepare(
					"UPDATE tasks SET completion_item_id = NULL WHERE completion_item_id IN (SELECT id FROM source_items WHERE source_id = ?)",
				).run(source.id);
				db.prepare(
					"DELETE FROM task_items WHERE item_id IN (SELECT id FROM source_items WHERE source_id = ?)",
				).run(source.id);
				db.prepare("UPDATE sources SET active = 0 WHERE id = ?").run(source.id);
			}
			for (const locator of names)
				db.prepare(
					"INSERT INTO sources (id, provider, locator, active) VALUES (?, 'github', ?, 1) ON CONFLICT(provider, locator) DO UPDATE SET active = 1",
				).run(randomUUID(), locator);
		}),
		markUnavailable: (id) => {
			db.prepare("UPDATE source_items SET available = 0 WHERE id = ?").run(id);
		},
		recordState: (id, state, at) => {
			db.prepare(
				`UPDATE source_items SET reopened_at = CASE WHEN state = 'closed' AND @state = 'open' THEN @at ELSE reopened_at END, state = @state, outcome = @outcome, available = 1, verified_at = @at, title = COALESCE(@title, title), url = COALESCE(@url, url) WHERE id = @id`,
			).run({
				id,
				state: state.state,
				outcome: state.outcome,
				at,
				title: state.title ?? null,
				url: state.url ?? null,
			});
			db.prepare(
				`UPDATE items SET closed_at = CASE WHEN @state = 'closed' THEN COALESCE(closed_at, @at) ELSE NULL END WHERE (repository, kind, CAST(number AS TEXT)) IN (SELECT s.locator, i.kind, i.external_id FROM source_items i JOIN sources s ON s.id = i.source_id WHERE i.id = @id AND s.provider = 'github')`,
			).run({ id, state: state.state, at });
		},
		list: () =>
			(
				db.prepare("SELECT * FROM sources WHERE active = 1 ORDER BY locator").all() as (Omit<
					Source,
					"active"
				> & { active: number })[]
			).map((row) => ({
				id: row.id,
				provider: row.provider,
				locator: row.locator,
				active: row.active === 1,
			})),
		items: (sourceId) =>
			db
				.prepare(
					`${ITEM_SELECT} WHERE s.active = 1 ${sourceId ? "AND s.id = ?" : ""} ORDER BY s.locator, i.kind, i.external_id`,
				)
				.all(...(sourceId ? [sourceId] : []))
				.map((row) => toItem(row)!),
		getItem: (id) => toItem(db.prepare(`${ITEM_SELECT} WHERE i.id = ? AND s.active = 1`).get(id)),
		identify: (ref) =>
			toItem(
				db
					.prepare(
						`${ITEM_SELECT} WHERE s.provider = 'github' AND s.locator = ? AND i.kind = ? AND i.external_id = ? AND s.active = 1`,
					)
					.get(ref.repository, ref.kind ?? "pull_request", String(ref.number)),
			),
	};
}
