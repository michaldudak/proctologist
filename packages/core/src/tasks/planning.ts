import type { Task } from "./types.js";
export type TaskView = "today" | "week" | "all";
export function localDate(date = new Date()): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function shiftDate(date: string, days: number): string {
	const value = new Date(`${date}T12:00:00Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
}
export function weekStart(date: string, locale?: string): string {
	const regional = new Intl.Locale(
		locale ?? new Intl.DateTimeFormat().resolvedOptions().locale,
	) as Intl.Locale & {
		getWeekInfo?: () => { firstDay: number };
		weekInfo?: { firstDay: number };
	};
	const first = regional.getWeekInfo?.().firstDay ?? regional.weekInfo?.firstDay ?? 1;
	const day = new Date(`${date}T12:00:00Z`).getUTCDay();
	return shiftDate(date, -((day - first + 7) % 7));
}
export function planTasks(
	tasks: Task[],
	view: TaskView,
	today: string,
	locale?: string,
): { earlier: Task[]; current: Task[]; done: Task[] } {
	const start = view === "week" ? weekStart(today, locale) : today;
	const end = view === "week" ? shiftDate(start, 6) : today;
	const within = (task: Task) =>
		view === "all" ||
		(task.plannedDate !== null && task.plannedDate >= start && task.plannedDate <= end);
	const ordered = tasks.toSorted(
		(a, b) =>
			(a.plannedDate ?? "9999").localeCompare(b.plannedDate ?? "9999") || a.position - b.position,
	);
	return {
		earlier:
			view === "all"
				? []
				: ordered.filter(
						(t) => t.stage !== "done" && t.plannedDate !== null && t.plannedDate < start,
					),
		current: ordered.filter((t) => t.stage !== "done" && within(t)),
		done: ordered.filter((t) => t.stage === "done" && within(t)),
	};
}
