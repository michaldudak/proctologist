import { Button } from "@cloudflare/kumo";
import { useState } from "react";
import { TASK_STAGE_LABELS, type Task } from "@proctologist/core/browser";
import type { ItemQuery } from "../../../shared/ipc.js";
import { useTaskData } from "../state/useData.js";
import { TaskEditor } from "./TaskEditor.js";
import { TaskSuggestions } from "./TaskSuggestions.js";

/** Resolves provider identities at the UI boundary; Tasks themselves never use GitHub numbers. */
export function ItemTasks({
	queries,
	compact = false,
}: {
	queries: ItemQuery[];
	compact?: boolean;
}): React.JSX.Element {
	const data = useTaskData();
	const [editing, setEditing] = useState<Task | "new" | null>(null);
	const [suggest, setSuggest] = useState(false);
	const items = (data.value?.items ?? []).filter((item) =>
		queries.some(
			(query) =>
				item.provider === "github" &&
				item.locator === query.repository &&
				item.kind === (query.kind ?? "pull_request") &&
				item.externalId === String(query.number),
		),
	);
	const tasks = (data.value?.tasks ?? []).filter((task) =>
		task.items.some((item) => items.some((selected) => selected.id === item.id)),
	);
	return (
		<section className={compact ? "item-task-actions" : "panel-section"}>
			{!compact ? <h3>Tasks</h3> : null}
			<Button size="xs" disabled={items.length === 0} onClick={() => setEditing("new")}>
				Create Task
			</Button>{" "}
			<Button size="xs" disabled={items.length === 0} onClick={() => setSuggest(true)}>
				Suggest Tasks
			</Button>
			{!compact ? (
				<ul className="linked-tasks">
					{tasks.map((task) => (
						<li key={task.id}>
							<button onClick={() => setEditing(task)}>{task.title}</button>{" "}
							<small>{TASK_STAGE_LABELS[task.stage]}</small>
						</li>
					))}
				</ul>
			) : null}
			{data.error ? <p role="alert">{data.error}</p> : null}
			{editing ? (
				<TaskEditor
					task={editing === "new" ? undefined : editing}
					initialItems={items}
					items={data.value?.items ?? []}
					onClose={() => {
						setEditing(null);
						data.reload();
					}}
				/>
			) : null}
			{suggest ? (
				<TaskSuggestions
					items={items}
					onClose={() => {
						setSuggest(false);
						data.reload();
					}}
				/>
			) : null}
		</section>
	);
}
