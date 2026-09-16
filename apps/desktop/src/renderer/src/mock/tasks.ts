import type { SourceItem, Task, TaskInput, TaskSuggestions, Job } from "@proctologist/core/browser";
import type { ItemRow, ProctologistApi } from "../../../shared/ipc.js";
export function mockTasks(
	rows: ItemRow[],
	changed: () => void,
	jobChanged: (job: Job) => void,
): Pick<
	ProctologistApi,
	| "listSources"
	| "listSourceItems"
	| "listTasks"
	| "createTask"
	| "updateTask"
	| "deleteTask"
	| "reorderTasks"
	| "startTaskSuggestions"
	| "getTaskSuggestions"
	| "acceptTaskSuggestions"
> {
	const items: SourceItem[] = rows.map(({ item }) => ({
		id: `${item.repository}:${item.kind}:${item.number}`,
		sourceId: item.repository,
		provider: "github",
		locator: item.repository,
		kind: item.kind,
		externalId: String(item.number),
		title: item.title,
		url: item.url,
		state: item.closedAt ? "closed" : "open",
		outcome: "unknown",
		available: true,
		verifiedAt: new Date().toISOString(),
		reopenedAt: null,
	}));
	let tasks: Task[] = [];
	const suggestions = new Map<string, TaskSuggestions>();
	const create = (input: TaskInput): Task => {
		const now = new Date().toISOString();
		const task: Task = {
			id: crypto.randomUUID(),
			title: input.title,
			stage: input.stage ?? "todo",
			plannedDate: input.plannedDate ?? null,
			deadline: input.deadline ?? null,
			note: input.note ?? "",
			position: tasks.length,
			completion: input.completion ?? null,
			items: items.filter((item) => input.itemIds?.includes(item.id)),
			createdAt: now,
			updatedAt: now,
			completedAt: null,
		};
		tasks.push(task);
		changed();
		return task;
	};
	return {
		listSources: async () =>
			[...new Set(items.map((item) => item.sourceId))].map((id) => ({
				id,
				provider: "github",
				locator: id,
				active: true,
			})),
		listSourceItems: async () => items,
		listTasks: async (filter) =>
			tasks.filter(
				(task) =>
					(!filter?.itemId || task.items.some((item) => item.id === filter.itemId)) &&
					(!filter?.sourceId || task.items.some((item) => item.sourceId === filter.sourceId)),
			),
		createTask: async (input) => create(input),
		updateTask: async ({ id, patch }) => {
			const task = tasks.find((candidate) => candidate.id === id);
			if (!task) throw new Error("Task not found");
			Object.assign(task, patch);
			if (patch.itemIds) task.items = items.filter((item) => patch.itemIds!.includes(item.id));
			changed();
			return { ...task };
		},
		deleteTask: async ({ id }) => {
			tasks = tasks.filter((task) => task.id !== id);
			changed();
		},
		reorderTasks: async ({ ids }) => {
			const positions = tasks
				.filter((task) => ids.includes(task.id))
				.map((task) => task.position)
				.toSorted((a, b) => a - b);
			ids.forEach((id, index) => {
				tasks.find((candidate) => candidate.id === id)!.position = positions[index]!;
			});
			tasks.sort((a, b) => a.position - b.position);
			changed();
		},
		startTaskSuggestions: async ({ itemIds }) => {
			const id = crypto.randomUUID();
			suggestions.set(id, {
				id,
				itemIds,
				suggestions: [{ title: "Investigate and test the selected change", itemIds }],
				accepted: [],
			});
			const now = new Date().toISOString();
			const job: Job = {
				id,
				kind: "task_suggestions",
				repository: items[0]?.locator ?? "",
				itemKind: "pull_request",
				number: null,
				parentId: null,
				state: "completed",
				progress: { done: 1, total: 1, label: "Suggestions ready to review" },
				error: null,
				createdAt: now,
				startedAt: now,
				finishedAt: now,
			};
			jobChanged(job);
			return job;
		},
		getTaskSuggestions: async ({ id }) => suggestions.get(id)!,
		acceptTaskSuggestions: async ({ id, choices }) => {
			const request = suggestions.get(id)!;
			return choices.map((choice) => {
				request.accepted.push(choice.index);
				return create(choice);
			});
		},
	};
}
