import { Button, Dialog } from "@cloudflare/kumo";
import { useState } from "react";
import {
	qualifiesForCompletion,
	TASK_STAGES,
	TASK_STAGE_LABELS,
	type SourceItem,
	type Task,
	type TaskStage,
} from "@proctologist/core/browser";
import { useApi } from "../api.js";

export function TaskEditor({
	task,
	initialItems = [],
	items,
	onClose,
}: {
	task?: Task;
	initialItems?: SourceItem[];
	items: SourceItem[];
	onClose: () => void;
}): React.JSX.Element {
	const api = useApi();
	const [title, setTitle] = useState(task?.title ?? initialItems[0]?.title ?? "");
	const [stage, setStage] = useState<TaskStage>(task?.stage ?? "todo");
	const [plannedDate, setPlannedDate] = useState(task?.plannedDate ?? "");
	const [deadline, setDeadline] = useState(task?.deadline ?? "");
	const [note, setNote] = useState(task?.note ?? "");
	const [ids, setIds] = useState((task?.items ?? initialItems).map((item) => item.id));
	const [controller, setController] = useState(task?.completion?.itemId ?? "");
	const [mode, setMode] = useState<"successful" | "any">(task?.completion?.mode ?? "successful");
	const [search, setSearch] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const linked = items.filter((item) => ids.includes(item.id));
	const controlling = linked.find((item) => item.id === controller);
	const reopening = task?.stage === "done" && stage !== "done";
	const completion = controlling && !reopening ? { itemId: controlling.id, mode } : null;
	const closes =
		stage !== "done" &&
		controlling &&
		completion &&
		qualifiesForCompletion(controlling, completion);
	const save = async () => {
		setBusy(true);
		setError("");
		try {
			const input = {
				title,
				plannedDate: plannedDate || null,
				deadline: deadline || null,
				note,
				itemIds: ids,
			};
			if (task) await api.updateTask({ id: task.id, patch: { ...input, stage, completion } });
			else await api.createTask({ ...input, stage, completion });
			onClose();
		} catch (cause) {
			setError(String(cause));
		} finally {
			setBusy(false);
		}
	};
	return (
		<Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
			<Dialog className="task-dialog">
				<Dialog.Title>{task ? "Edit Task" : "New Task"}</Dialog.Title>
				<Dialog.Description>
					Plan your own work. Linked GitHub items keep their own status.
				</Dialog.Description>
				<form
					onSubmit={(event) => {
						event.preventDefault();
						void save();
					}}
					className="task-form"
				>
					<label>
						Title
						<input
							autoFocus
							required
							value={title}
							onChange={(event) => setTitle(event.target.value)}
						/>
					</label>
					<div className="task-fields">
						<label>
							Stage
							<select value={stage} onChange={(event) => setStage(event.target.value as TaskStage)}>
								{TASK_STAGES.map((value) => (
									<option key={value} value={value}>
										{TASK_STAGE_LABELS[value]}
									</option>
								))}
							</select>
						</label>
						<label>
							Planned date
							<input
								type="date"
								value={plannedDate}
								onInput={(event) => setPlannedDate(event.currentTarget.value)}
							/>
						</label>
						<label>
							Deadline
							<input
								type="date"
								value={deadline}
								onInput={(event) => setDeadline(event.currentTarget.value)}
							/>
						</label>
					</div>
					{plannedDate && deadline && plannedDate > deadline ? (
						<p role="status" className="task-warning">
							Planned after the deadline. Both dates will be kept.
						</p>
					) : null}
					<label>
						Private note
						<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
						<small>Never included in Task suggestion prompts.</small>
					</label>
					<fieldset>
						<legend>Linked items</legend>
						{linked.map((item) => (
							<div key={item.id} className="task-linked-item">
								<span>
									{item.locator} · {item.kind === "issue" ? "Issue" : "PR"} #{item.externalId} —{" "}
									{item.title}
									{!item.available ? " · Unavailable" : item.state === "closed" ? " · Closed" : ""}
								</span>
								<button
									type="button"
									onClick={() => {
										setIds(ids.filter((id) => id !== item.id));
										if (controller === item.id) setController("");
									}}
								>
									{controller === item.id ? "Unlink (turns off completion)" : "Unlink"}
								</button>
							</div>
						))}
						<label>
							Find an item
							<input
								type="search"
								placeholder="Search fetched issues and PRs"
								value={search}
								onChange={(event) => setSearch(event.target.value)}
							/>
						</label>
						{search ? (
							<div className="task-item-results">
								{items
									.filter(
										(item) =>
											!ids.includes(item.id) &&
											`${item.locator} ${item.externalId} ${item.title}`
												.toLowerCase()
												.includes(search.toLowerCase()),
									)
									.slice(0, 30)
									.map((item) => (
										<button
											type="button"
											key={item.id}
											onClick={() => {
												setIds([...ids, item.id]);
												setSearch("");
											}}
										>
											{item.locator} #{item.externalId} — {item.title}
										</button>
									))}
							</div>
						) : null}
					</fieldset>
					{linked.length > 0 ? (
						<fieldset>
							<legend>Automatic completion</legend>
							<label>
								Controlling item
								<select
									disabled={reopening}
									value={controller}
									onChange={(event) => setController(event.target.value)}
								>
									<option value="">Off — complete manually</option>
									{linked.map((item) => (
										<option key={item.id} value={item.id}>
											{item.locator} #{item.externalId} — {item.title}
										</option>
									))}
								</select>
							</label>
							{controller && !reopening ? (
								<label>
									Complete when
									<select
										value={mode}
										onChange={(event) => setMode(event.target.value as "successful" | "any")}
									>
										<option value="successful">Merged PR or completed issue</option>
										<option value="any">Closed for any reason</option>
									</select>
								</label>
							) : null}
							{reopening ? (
								<p className="task-warning">
									Reopening this Task will turn off automatic completion.
								</p>
							) : closes ? (
								<p className="task-warning" role="status">
									This item already qualifies. Saving will mark the Task Done immediately.
								</p>
							) : controlling && !controlling.available ? (
								<p className="task-warning">
									Automatic completion is paused until this item can be verified.
								</p>
							) : null}
						</fieldset>
					) : null}
					{error ? (
						<p role="alert" className="error">
							{error}
						</p>
					) : null}
					<div className="dialog-actions">
						<Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" variant="primary" disabled={busy || !title.trim()}>
							{closes ? "Save and complete" : "Save Task"}
						</Button>
					</div>
				</form>
			</Dialog>
		</Dialog.Root>
	);
}
