import type { Task, TaskPatch } from "@proctologist/core/browser";

/** Preserve changes made by refresh while this editor was open. */
export function editedTaskPatch(original: Task, draft: TaskPatch): TaskPatch {
	const patch = { ...draft };
	for (const field of ["title", "stage", "plannedDate", "deadline", "note"] as const) {
		if (patch[field] === original[field]) delete patch[field];
	}
	if (
		patch.itemIds &&
		patch.itemIds.length === original.items.length &&
		original.items.every((item) => patch.itemIds!.includes(item.id))
	)
		delete patch.itemIds;
	if (
		patch.completion?.itemId === original.completion?.itemId &&
		patch.completion?.mode === original.completion?.mode
	)
		delete patch.completion;
	return patch;
}
