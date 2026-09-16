import type { Job, SourceItem } from "@proctologist/core/browser";
import { TaskSuggestions } from "./TaskSuggestions.js";
import { Button } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import {
	localDate,
	planTasks,
	TASK_STAGE_LABELS,
	type Task,
	type TaskView,
} from "@proctologist/core/browser";
import { useApi } from "../api.js";
import { useTaskData, useJobs } from "../state/useData.js";
import { TaskEditor } from "./TaskEditor.js";

export function TasksPage(): React.JSX.Element {
	const api = useApi();
	const data = useTaskData();
	const jobs = useJobs();
	const [suggestion, setSuggestion] = useState<{ job: Job; items: SourceItem[] } | null>(null);
	const [view, setView] = useState<TaskView>("today");
	const [source, setSource] = useState("");
	const [editing, setEditing] = useState<Task | "new" | null>(null);
	const [deleting, setDeleting] = useState<string | null>(null);
	const [error, setError] = useState("");
	const [today, setToday] = useState(localDate);
	useEffect(() => {
		const timer = setInterval(() => setToday(localDate()), 30_000);
		return () => clearInterval(timer);
	}, []);
	const run = (work: Promise<unknown>) => {
		setError("");
		void work.catch((cause) => setError(String(cause)));
	};
	const tasks = data.value?.tasks ?? [];
	const groups = planTasks(
		tasks.filter((task) => !source || task.items.some((item) => item.sourceId === source)),
		view,
		today,
		api.locale,
	);
	function rows(entries: Task[]) {
		return entries.map((task, index) => (
			<li className="task-row" key={task.id}>
				<input
					type="checkbox"
					aria-label={`Mark ${task.title} ${task.stage === "done" ? "To do" : "Done"}`}
					checked={task.stage === "done"}
					onChange={() =>
						run(
							api.updateTask({
								id: task.id,
								patch: { stage: task.stage === "done" ? "todo" : "done" },
							}),
						)
					}
				/>
				<div className="task-row-content">
					<button className="task-title" onClick={() => setEditing(task)}>
						{task.title}
					</button>
					<div className="task-meta">
						<span>{TASK_STAGE_LABELS[task.stage]}</span>
						<span>{task.plannedDate ?? "Unplanned"}</span>
						{task.deadline ? (
							<span
								className={task.deadline < today && task.stage !== "done" ? "task-warning" : ""}
							>
								Due {task.deadline}
							</span>
						) : null}
						{task.plannedDate && task.deadline && task.plannedDate > task.deadline ? (
							<span className="task-warning">Planned after deadline</span>
						) : null}
						{task.items.map((item) => (
							<button key={item.id} onClick={() => run(api.openOnGitHub({ url: item.url }))}>
								{item.locator} #{item.externalId}
								{!item.available
									? " · Unavailable"
									: item.state === "open" && item.reopenedAt && task.stage === "done"
										? " · Reopened"
										: ""}
							</button>
						))}
					</div>
				</div>
				<div className="task-row-actions">
					<button
						aria-label={`Move ${task.title} up`}
						disabled={index === 0 || entries[index - 1]?.plannedDate !== task.plannedDate}
						onClick={() => {
							const ids = entries
								.filter((entry) => entry.plannedDate === task.plannedDate)
								.map((entry) => entry.id);
							const position = ids.indexOf(task.id);
							[ids[position - 1], ids[position]] = [ids[position]!, ids[position - 1]!];
							run(api.reorderTasks({ ids }));
						}}
					>
						↑
					</button>
					<button
						aria-label={`Move ${task.title} down`}
						disabled={
							index === entries.length - 1 || entries[index + 1]?.plannedDate !== task.plannedDate
						}
						onClick={() => {
							const ids = entries
								.filter((entry) => entry.plannedDate === task.plannedDate)
								.map((entry) => entry.id);
							const position = ids.indexOf(task.id);
							[ids[position], ids[position + 1]] = [ids[position + 1]!, ids[position]!];
							run(api.reorderTasks({ ids }));
						}}
					>
						↓
					</button>
					{deleting === task.id ? (
						<>
							<button
								onClick={() => {
									run(api.deleteTask({ id: task.id }));
									setDeleting(null);
								}}
							>
								Confirm delete
							</button>
							<button onClick={() => setDeleting(null)}>Cancel</button>
						</>
					) : (
						<button aria-label={`Delete ${task.title}`} onClick={() => setDeleting(task.id)}>
							Delete
						</button>
					)}
				</div>
			</li>
		));
	}
	return (
		<main className="tasks-page">
			<div className="tasks-heading">
				<div>
					<h1>Tasks</h1>
					<p>Your plan, across all sources.</p>
				</div>
				<Button variant="primary" onClick={() => setEditing("new")}>
					New Task
				</Button>
			</div>
			<div className="tasks-toolbar">
				<div className="task-views" role="group" aria-label="Planning period">
					{(
						[
							["today", "Today"],
							["week", "This week"],
							["all", "All"],
						] as const
					).map(([value, label]) => (
						<Button
							key={value}
							variant={view === value ? "secondary" : "ghost"}
							aria-pressed={view === value}
							onClick={() => setView(value)}
						>
							{label}
						</Button>
					))}
				</div>
				<label>
					Source{" "}
					<select value={source} onChange={(event) => setSource(event.target.value)}>
						<option value="">All sources</option>
						{data.value?.sources.map((item) => (
							<option key={item.id} value={item.id}>
								{item.locator}
							</option>
						))}
					</select>
				</label>
			</div>
			{jobs.some((job) => job.kind === "task_suggestions") ? (
				<details className="task-suggestion-history">
					<summary>Task suggestions</summary>
					{jobs
						.filter((job) => job.kind === "task_suggestions")
						.map((job) => (
							<div key={job.id}>
								<button
									onClick={() =>
										run(
											api.getTaskSuggestions({ id: job.id }).then((request) =>
												setSuggestion({
													job,
													items: (data.value?.items ?? []).filter((item) =>
														request.itemIds.includes(item.id),
													),
												}),
											),
										)
									}
								>
									{job.repository} · {new Date(job.createdAt).toLocaleString(api.locale)} ·{" "}
									{job.state}
								</button>
							</div>
						))}
				</details>
			) : null}
			{suggestion ? (
				<TaskSuggestions
					items={suggestion.items}
					existingJob={suggestion.job}
					onClose={() => {
						setSuggestion(null);
						data.reload();
					}}
				/>
			) : null}
			{data.error || error ? (
				<p className="error" role="alert">
					{data.error ?? error}
				</p>
			) : null}
			{data.loading ? (
				<p>Loading Tasks…</p>
			) : (
				<>
					{groups.earlier.length > 0 ? (
						<section>
							<h2>Earlier</h2>
							<ul className="task-list">{rows(groups.earlier)}</ul>
						</section>
					) : null}
					<section>
						<h2>{view === "today" ? "Today" : view === "week" ? "This week" : "All unfinished"}</h2>
						{groups.current.length > 0 ? (
							<ul className="task-list">{rows(groups.current)}</ul>
						) : (
							<p className="task-empty">
								{tasks.length === 0
									? "Start with a Task of your own, or create one from a GitHub issue or pull request."
									: "Nothing planned here. Choose All to find unplanned Tasks."}
							</p>
						)}
					</section>
					<details className="task-done">
						<summary>Done ({groups.done.length})</summary>
						<ul className="task-list">{rows(groups.done)}</ul>
					</details>
				</>
			)}
			{editing ? (
				<TaskEditor
					task={editing === "new" ? undefined : editing}
					items={data.value?.items ?? []}
					onClose={() => {
						setEditing(null);
						data.reload();
					}}
				/>
			) : null}
		</main>
	);
}
