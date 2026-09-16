import { afterEach, beforeEach, expect, it } from "vitest";
import { openStore, type Store } from "../store/store.js";
import type { IssueFacts } from "../store/types.js";

let store: Store;
const NOW = "2026-09-16T10:00:00.000Z";
function item(number: number, repository = "owner/repo"): IssueFacts {
	return {
		repository,
		kind: "issue",
		number,
		title: `Issue ${number}`,
		url: `https://github.com/${repository}/issues/${number}`,
		author: "someone",
		isBot: false,
		authorAssociation: "NONE",
		authoredByUser: false,
		createdAt: NOW,
		updatedAt: NOW,
		changedAt: NOW,
		labels: [],
		lastActivityBy: "someone",
		lastActivityAt: NOW,
		lastActivityByUser: false,
		assignees: [],
		milestone: null,
		comments: 0,
		upvotes: 0,
		downvotes: 0,
		linkedPullRequests: [],
		stateReason: null,
	};
}
function seed(number: number, repository = "owner/repo"): string {
	store.items.upsert(item(number, repository), NOW);
	return store.sources.identify({ repository, kind: "issue", number })!.id;
}
beforeEach(() => {
	store = openStore(":memory:");
});
afterEach(() => store.close());
it("keeps a Task's title independent and supports shared Item links and standalone Tasks", () => {
	const first = seed(1);
	const second = seed(2, "other/repo");
	const task = store.tasks.create({
		title: "Investigate keyboard navigation",
		itemIds: [first, second],
	});
	store.tasks.create({ title: "Write regression test", itemIds: [first] });
	store.tasks.create({ title: "Plan the day" });
	store.items.upsert({ ...item(1), title: "Renamed upstream" }, NOW);
	expect(store.tasks.get(task.id)).toMatchObject({
		title: "Investigate keyboard navigation",
		stage: "todo",
		plannedDate: null,
		deadline: null,
		completion: null,
	});
	expect(store.tasks.get(task.id)?.items.map((linked) => linked.title)).toEqual([
		"Renamed upstream",
		"Issue 2",
	]);
	expect(store.tasks.list()).toHaveLength(3);
	expect(store.tasks.list({ itemId: first })).toHaveLength(2);
});
it("only completes through the chosen Item and lets manual reopening disable the rule", () => {
	const controlling = seed(1);
	const context = seed(2);
	const task = store.tasks.create({ title: "Fix", itemIds: [controlling, context] });
	store.tasks.update(task.id, { completion: { itemId: controlling, mode: "successful" } });
	store.sources.recordState(context, { state: "closed", outcome: "successful" }, NOW);
	store.tasks.applyCompletionRules();
	expect(store.tasks.get(task.id)?.stage).toBe("todo");
	store.sources.recordState(controlling, { state: "closed", outcome: "other" }, NOW);
	store.tasks.applyCompletionRules();
	expect(store.tasks.get(task.id)?.stage).toBe("todo");
	store.tasks.update(task.id, { completion: { itemId: controlling, mode: "any" } });
	expect(store.tasks.get(task.id)?.stage).toBe("done");
	store.tasks.update(task.id, { stage: "doing" });
	store.tasks.applyCompletionRules();
	expect(store.tasks.get(task.id)).toMatchObject({ stage: "doing", completion: null });
});
it("preserves Done after an Item reopens and pauses completion while it is unavailable", () => {
	const id = seed(1);
	const task = store.tasks.create({ title: "Fix", itemIds: [id] });
	store.tasks.update(task.id, { completion: { itemId: id, mode: "successful" } });
	store.sources.recordState(id, { state: "closed", outcome: "successful" }, NOW);
	store.sources.markUnavailable(id);
	store.tasks.applyCompletionRules();
	expect(store.tasks.get(task.id)?.stage).toBe("todo");
	store.sources.recordState(id, { state: "closed", outcome: "successful" }, NOW);
	store.tasks.applyCompletionRules();
	const completedAt = store.tasks.get(task.id)?.completedAt;
	store.tasks.applyCompletionRules();
	expect(store.tasks.get(task.id)?.completedAt).toBe(completedAt);
	store.sources.recordState(id, { state: "open", outcome: "unknown" }, "2026-09-17T10:00:00.000Z");
	store.tasks.applyCompletionRules();
	expect(store.tasks.get(task.id)?.stage).toBe("done");
	expect(store.sources.getItem(id)?.reopenedAt).toBe("2026-09-17T10:00:00.000Z");
});
it("protects linked Items from retention but detaches removed Sources without deleting Tasks", () => {
	const id = seed(1);
	const other = seed(2, "other/repo");
	const task = store.tasks.create({ title: "Follow up", itemIds: [id, other] });
	store.sources.recordState(id, { state: "closed", outcome: "successful" }, NOW);
	store.tasks.update(task.id, { completion: { itemId: id, mode: "successful" } });
	expect(store.items.purgeClosed("owner/repo", { before: "2027-01-01" })).toBe(0);
	store.sources.reconcile(["other/repo"]);
	expect(store.tasks.get(task.id)).toMatchObject({ stage: "done", completion: null });
	expect(store.tasks.get(task.id)?.items.map((linked) => linked.id)).toEqual([other]);
	store.sources.reconcile(["other/repo", "owner/repo"]);
	expect(store.tasks.get(task.id)?.items).toHaveLength(1);
	store.tasks.delete(task.id);
	expect(store.sources.getItem(other)).toBeDefined();
	expect(store.tasks.list()).toEqual([]);
});
it("rejects invalid dates and preserves hidden positions when reordering a filtered list", () => {
	const a = store.tasks.create({ title: "A" });
	const hidden = store.tasks.create({ title: "Hidden" });
	const b = store.tasks.create({ title: "B" });
	expect(() => store.tasks.update(a.id, { plannedDate: "2026-02-30" })).toThrow();
	expect(() => store.tasks.create({ title: "Invalid", deadline: "tomorrow" })).toThrow();
	store.tasks.reorder([b.id, a.id]);
	expect(store.tasks.list().map((t) => t.id)).toEqual([b.id, hidden.id, a.id]);
	expect(() => store.tasks.reorder([a.id, a.id])).toThrow();
});
it("disables a completion rule when its controller is unlinked without changing stage", () => {
	const id = seed(1);
	const task = store.tasks.create({ title: "Work", itemIds: [id] });
	store.tasks.update(task.id, { completion: { itemId: id, mode: "successful" } });
	expect(store.tasks.update(task.id, { itemIds: [] })).toMatchObject({
		stage: "todo",
		completion: null,
	});
});
