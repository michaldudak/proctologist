import { expect, it } from "vitest";
import { planTasks, weekStart, localDate } from "./planning.js";
import type { Task } from "./types.js";
const task = (id: string, plannedDate: string | null, stage: Task["stage"] = "todo"): Task => ({
	id,
	plannedDate,
	stage,
	title: id,
	note: "",
	deadline: null,
	position: 0,
	completion: null,
	items: [],
	completedAt: null,
	createdAt: "",
	updatedAt: "",
});
it("uses locale week boundaries across years", () => {
	expect(weekStart("2027-01-01", "pl-PL")).toBe("2026-12-28");
	expect(weekStart("2027-01-01", "en-US")).toBe("2026-12-27");
});
it("separates unfinished Earlier work from the dated Done section without moving dates", () => {
	const tasks = [
		task("old", "2026-09-10"),
		task("yesterday", "2026-09-15"),
		task("today", "2026-09-16"),
		task("done", "2026-09-16", "done"),
		task("old done", "2026-09-10", "done"),
		task("undated", null),
	];
	const today = planTasks(tasks, "today", "2026-09-16", "pl-PL");
	expect(today.earlier.map((t) => t.id)).toEqual(["old", "yesterday"]);
	expect(today.current.map((t) => t.id)).toEqual(["today"]);
	expect(today.done.map((t) => t.id)).toEqual(["done"]);
	expect(planTasks(tasks, "week", "2026-09-16", "pl-PL").earlier.map((t) => t.id)).toEqual(["old"]);
	expect(planTasks(tasks, "all", "2026-09-16", "pl-PL").current.map((t) => t.id)).toContain(
		"undated",
	);
	expect(tasks[0]?.plannedDate).toBe("2026-09-10");
});
it("uses the local calendar across midnight without converting planned dates", () => {
	const previous = process.env["TZ"];
	process.env["TZ"] = "Europe/Warsaw";
	try {
		expect(localDate(new Date("2026-09-15T22:01:00Z"))).toBe("2026-09-16");
		expect(localDate(new Date("2026-09-15T21:59:00Z"))).toBe("2026-09-15");
	} finally {
		if (previous === undefined) delete process.env["TZ"];
		else process.env["TZ"] = previous;
	}
});
