import { expect, it } from "vitest";
import { openStore } from "../store/store.js";
import { suggestionPrompt, validateSuggestions } from "./suggestions.js";
import type { Task } from "./types.js";
it("only shares permitted context from unfinished Tasks linked to the selection", () => {
	const task = {
		id: "a",
		title: "Existing action",
		stage: "doing",
		plannedDate: "2026-09-16",
		deadline: null,
		note: "SECRET NOTE",
		items: [{ id: "chosen" }],
	} as Task;
	const prompt = suggestionPrompt(
		[{ id: "chosen", context: { title: "External item" } }],
		[
			task,
			{ ...task, title: "UNRELATED", items: [{ id: "other" }] } as Task,
			{ ...task, title: "COMPLETED", stage: "done" },
		],
	);
	expect(prompt).toContain("Existing action");
	expect(prompt).not.toContain("SECRET NOTE");
	expect(prompt).not.toContain("UNRELATED");
	expect(prompt).not.toContain("COMPLETED");
	expect(() =>
		validateSuggestions({ suggestions: [{ title: "Work", itemIds: ["other"] }] }, ["chosen"]),
	).toThrow();
	expect(() =>
		validateSuggestions({ suggestions: [{ title: "Work", itemIds: [], deadline: "2026-01-01" }] }, [
			"chosen",
		]),
	).toThrow();
});
it("does not create Tasks until selected suggestions are explicitly accepted, transactionally and once", () => {
	const store = openStore(":memory:");
	try {
		store.taskSuggestions.create("job", []);
		store.taskSuggestions.complete("job", [
			{ title: "First", itemIds: [] },
			{ title: "Second", itemIds: [] },
		]);
		expect(store.tasks.list()).toEqual([]);
		const accepted = store.taskSuggestions.accept("job", [
			{ index: 1, title: "Edited action", itemIds: [], plannedDate: "2026-09-17" },
		]);
		expect(accepted).toHaveLength(1);
		expect(accepted[0]).toMatchObject({
			title: "Edited action",
			stage: "todo",
			completion: null,
			plannedDate: "2026-09-17",
			deadline: null,
		});
		expect(() =>
			store.taskSuggestions.accept("job", [{ index: 1, title: "Again", itemIds: [] }]),
		).toThrow();
		expect(store.tasks.list()).toHaveLength(1);
	} finally {
		store.close();
	}
});
