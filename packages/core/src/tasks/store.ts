import { randomUUID } from "node:crypto";
import type { Database } from "better-sqlite3";
import type { SourceRepository } from "../sources/store.js";
import { StoreError } from "../store/types.js";
import {
	qualifiesForCompletion,
	TASK_STAGES,
	type Task,
	type TaskInput,
	type TaskFilter,
	type TaskPatch,
} from "./types.js";

export interface TaskRepository {
	reorder: (ids: string[]) => void;
	delete: (id: string) => void;
	create: (input: TaskInput) => Task;
	update: (id: string, patch: TaskPatch) => Task;
	applyCompletionRules: () => void;
	get: (id: string) => Task | undefined;
	list: (filter?: TaskFilter) => Task[];
}
interface TaskRow {
	id: string;
	title: string;
	stage: Task["stage"];
	planned_date: string | null;
	deadline: string | null;
	note: string;
	position: number;
	completion_item_id: string | null;
	completion_mode: "successful" | "any";
	completed_at: string | null;
	created_at: string;
	updated_at: string;
}
function validateDates(input: Pick<TaskPatch, "plannedDate" | "deadline">): void {
	for (const value of [input.plannedDate, input.deadline]) {
		if (value == null) continue;
		if (
			!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
			!Number.isFinite(Date.parse(value)) ||
			new Date(value).toISOString().slice(0, 10) !== value
		)
			throw new StoreError("Dates must be valid calendar dates (YYYY-MM-DD).");
	}
}
export function createTaskRepository(db: Database, sources: SourceRepository): TaskRepository {
	const links = db.prepare("SELECT item_id FROM task_items WHERE task_id = ? ORDER BY rowid");
	function read(row: TaskRow): Task {
		return {
			id: row.id,
			title: row.title,
			stage: row.stage,
			plannedDate: row.planned_date,
			deadline: row.deadline,
			note: row.note,
			position: row.position,
			completion: row.completion_item_id
				? { itemId: row.completion_item_id, mode: row.completion_mode }
				: null,
			completedAt: row.completed_at,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
			items: (links.all(row.id) as { item_id: string }[]).flatMap(({ item_id }) => {
				const item = sources.getItem(item_id);
				return item ? [item] : [];
			}),
		};
	}
	const get = (id: string): Task | undefined => {
		const row = db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
		return row ? read(row) : undefined;
	};
	function complete(task: Task): void {
		if (task.stage === "done" || !task.completion) return;
		const item = sources.getItem(task.completion.itemId);
		if (item && qualifiesForCompletion(item, task.completion)) {
			const at = new Date().toISOString();
			db.prepare(
				"UPDATE tasks SET stage = 'done', completed_at = ?, updated_at = ? WHERE id = ?",
			).run(at, at, task.id);
		}
	}
	const repository: TaskRepository = {
		get,
		reorder: db.transaction((ids: string[]) => {
			if (new Set(ids).size !== ids.length)
				throw new StoreError("A Task may only appear once in an order.");
			const tasks = ids.map((id) => {
				const task = get(id);
				if (!task) throw new StoreError("Task not found.");
				return task;
			});
			const positions = tasks.map((task) => task.position).toSorted((a, b) => a - b);
			const write = db.prepare("UPDATE tasks SET position = ? WHERE id = ?");
			tasks.forEach((task, index) => write.run(positions[index], task.id));
		}),
		delete: (id) => {
			db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
		},
		applyCompletionRules: db.transaction(() => {
			for (const row of db
				.prepare("SELECT * FROM tasks WHERE completion_item_id IS NOT NULL AND stage <> 'done'")
				.all() as TaskRow[])
				complete(read(row));
		}),
		update: db.transaction((id: string, patch: TaskPatch) => {
			validateDates(patch);
			const task = get(id);
			if (!task) throw new StoreError("Task not found.");
			const title = patch.title?.trim() ?? task.title;
			if (!title) throw new StoreError("A Task needs a title.");
			const stage = patch.stage ?? task.stage;
			if (!TASK_STAGES.includes(stage)) throw new StoreError("Unknown Task stage.");
			const ids = [...new Set(patch.itemIds ?? task.items.map((item) => item.id))];
			for (const itemId of ids)
				if (!sources.getItem(itemId))
					throw new StoreError("Only fetched Items from tracked Sources can be linked.");
			let completion = patch.completion === undefined ? task.completion : patch.completion;
			if (completion && !["successful", "any"].includes(completion.mode))
				throw new StoreError("Unknown completion rule.");
			if (completion && !ids.includes(completion.itemId)) {
				if (patch.completion)
					throw new StoreError("The controlling Item must be linked to the Task.");
				completion = null;
			}
			if (task.stage === "done" && stage !== "done") completion = null;
			const at = new Date().toISOString();
			db.prepare(
				`UPDATE tasks SET title = ?, stage = ?, planned_date = ?, deadline = ?, note = ?, completion_item_id = ?, completion_mode = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
			).run(
				title,
				stage,
				patch.plannedDate === undefined ? task.plannedDate : patch.plannedDate,
				patch.deadline === undefined ? task.deadline : patch.deadline,
				patch.note ?? task.note,
				completion?.itemId ?? null,
				completion?.mode ?? "successful",
				stage === "done" ? (task.completedAt ?? at) : null,
				at,
				id,
			);
			db.prepare("DELETE FROM task_items WHERE task_id = ?").run(id);
			for (const itemId of ids)
				db.prepare("INSERT INTO task_items (task_id, item_id) VALUES (?, ?)").run(id, itemId);
			complete(get(id)!);
			return get(id)!;
		}),
		list: (filter = {}) =>
			(db.prepare("SELECT * FROM tasks ORDER BY position, id").all() as TaskRow[])
				.map(read)
				.filter(
					(task) =>
						(!filter.itemId || task.items.some((item) => item.id === filter.itemId)) &&
						(!filter.sourceId || task.items.some((item) => item.sourceId === filter.sourceId)),
				),
		create: db.transaction((input: TaskInput) => {
			validateDates(input);
			if (!input.title.trim()) throw new StoreError("A Task needs a title.");
			const ids = [...new Set(input.itemIds ?? [])];
			for (const id of ids)
				if (!sources.getItem(id))
					throw new StoreError("Only fetched Items from tracked Sources can be linked.");
			const id = randomUUID();
			const at = new Date().toISOString();
			db.prepare(
				`INSERT INTO tasks (id, title, planned_date, deadline, note, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM tasks), ?, ?)`,
			).run(
				id,
				input.title.trim(),
				input.plannedDate ?? null,
				input.deadline ?? null,
				input.note ?? "",
				at,
				at,
			);
			for (const itemId of ids)
				db.prepare("INSERT INTO task_items (task_id, item_id) VALUES (?, ?)").run(id, itemId);
			return repository.update(id, {
				stage: input.stage ?? "todo",
				completion: input.completion ?? null,
			});
		}),
	};
	return repository;
}
