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
	const activeGitHub = db.prepare("SELECT * FROM sources WHERE provider = 'github' AND active = 1");
	const disableCompletion = db.prepare(
		"UPDATE tasks SET completion_item_id = NULL WHERE completion_item_id IN (SELECT id FROM source_items WHERE source_id = ?)",
	);
	const detachLinks = db.prepare(
		"DELETE FROM task_items WHERE item_id IN (SELECT id FROM source_items WHERE source_id = ?)",
	);
	const deactivate = db.prepare("UPDATE sources SET active = 0 WHERE id = ?");
	const activate = db.prepare(
		"INSERT INTO sources (id, provider, locator, active) VALUES (?, 'github', ?, 1) ON CONFLICT(provider, locator) DO UPDATE SET active = 1",
	);
	const unavailable = db.prepare("UPDATE source_items SET available = 0 WHERE id = ?");
	const updateState = db.prepare(
		`UPDATE source_items SET reopened_at = CASE WHEN state = 'closed' AND @state = 'open' THEN @at ELSE reopened_at END, state = @state, outcome = @outcome, available = 1, verified_at = @at, title = COALESCE(@title, title), url = COALESCE(@url, url) WHERE id = @id`,
	);
	const updateLegacyState = db.prepare(
		`UPDATE items SET closed_at = CASE WHEN @state = 'closed' THEN COALESCE(closed_at, @at) ELSE NULL END WHERE (repository, kind, CAST(number AS TEXT)) IN (SELECT s.locator, i.kind, i.external_id FROM source_items i JOIN sources s ON s.id = i.source_id WHERE i.id = @id AND s.provider = 'github')`,
	);
	const activeSources = db.prepare("SELECT * FROM sources WHERE active = 1 ORDER BY locator");
	const allItems = db.prepare(
		`${ITEM_SELECT} WHERE s.active = 1 ORDER BY s.locator, i.kind, i.external_id`,
	);
	const sourceItems = db.prepare(
		`${ITEM_SELECT} WHERE s.active = 1 AND s.id = ? ORDER BY s.locator, i.kind, i.external_id`,
	);
	const itemById = db.prepare(`${ITEM_SELECT} WHERE i.id = ? AND s.active = 1`);
	const itemByRef = db.prepare(
		`${ITEM_SELECT} WHERE s.provider = 'github' AND s.locator = ? AND i.kind = ? AND i.external_id = ? AND s.active = 1`,
	);
	return {
		reconcile: db.transaction((repositories: string[]) => {
			const names = new Set(repositories);
			for (const source of activeGitHub.all() as Source[]) {
				if (names.has(source.locator)) continue;
				disableCompletion.run(source.id);
				detachLinks.run(source.id);
				deactivate.run(source.id);
			}
			for (const locator of names) activate.run(randomUUID(), locator);
		}),
		markUnavailable: (id) => {
			unavailable.run(id);
		},
		recordState: (id, state, at) => {
			updateState.run({
				id,
				state: state.state,
				outcome: state.outcome,
				at,
				title: state.title ?? null,
				url: state.url ?? null,
			});
			updateLegacyState.run({ id, state: state.state, at });
		},
		list: () =>
			(activeSources.all() as (Omit<Source, "active"> & { active: number })[]).map((row) => ({
				id: row.id,
				provider: row.provider,
				locator: row.locator,
				active: row.active === 1,
			})),
		items: (sourceId) =>
			(sourceId ? sourceItems.all(sourceId) : allItems.all()).map((row) => toItem(row)!),
		getItem: (id) => toItem(itemById.get(id)),
		identify: (ref) =>
			toItem(itemByRef.get(ref.repository, ref.kind ?? "pull_request", String(ref.number))),
	};
}
