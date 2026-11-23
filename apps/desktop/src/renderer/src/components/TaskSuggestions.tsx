import { MAX_TASK_SUGGESTION_ITEMS } from "@proctologist/core/browser";
import { TaskSuggestionLinks } from "./TaskSuggestionLinks.js";
import { Button, Dialog } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import type {
	AcceptedSuggestion,
	SourceItem,
	TaskSuggestions as Suggestions,
} from "@proctologist/core/browser";
import type { Job } from "../../../shared/ipc.js";
import { useApi } from "../api.js";
import { useJobs } from "../state/useData.js";
import { isActiveJob } from "../lib/jobs.js";

export function TaskSuggestions({
	items,
	onClose,
	existingJob,
}: {
	items: SourceItem[];
	onClose: () => void;
	existingJob?: Job;
}): React.JSX.Element {
	const api = useApi();
	const jobs = useJobs();
	const [started, setStarted] = useState<Job | null>(existingJob ?? null);
	const [result, setResult] = useState<Suggestions | null>(null);
	const [choices, setChoices] = useState<AcceptedSuggestion[]>([]);
	const [selected, setSelected] = useState<number[]>([]);
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const job = jobs.find((candidate) => candidate.id === started?.id) ?? started;
	useEffect(() => {
		if (job?.state !== "completed" || result) return;
		let cancelled = false;
		void api
			.getTaskSuggestions({ id: job.id })
			.then((value) => {
				if (cancelled) return undefined;
				setResult(value);
				setChoices(
					(value.suggestions ?? []).map((suggestion, index) => ({
						title: suggestion.title,
						itemIds: suggestion.itemIds,
						index,
					})),
				);
				setSelected(
					(value.suggestions ?? [])
						.map((_, index) => index)
						.filter((index) => !value.accepted.includes(index)),
				);
				return undefined;
			})
			.catch((cause) => {
				if (!cancelled) setError(String(cause));
			});
		return () => {
			cancelled = true;
		};
	}, [api, job?.id, job?.state, result]);
	const start = async () => {
		setBusy(true);
		setError("");
		try {
			setStarted(await api.startTaskSuggestions({ itemIds: items.map((item) => item.id) }));
		} catch (cause) {
			setError(String(cause));
		} finally {
			setBusy(false);
		}
	};
	const accept = async () => {
		if (!result) return;
		setBusy(true);
		setError("");
		try {
			await api.acceptTaskSuggestions({
				id: result.id,
				choices: choices.filter((choice) => selected.includes(choice.index)),
			});
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
				<Dialog.Title>Suggest Tasks</Dialog.Title>
				<Dialog.Description>
					A local agent will use {items.length} selected item{items.length === 1 ? "" : "s"} and
					their unfinished Tasks. Private notes are excluded. You choose what to add.
				</Dialog.Description>
				{job ? (
					<p role="status">
						{job.state === "failed"
							? job.error
							: job.state === "aborted"
								? "Stopped"
								: (job.progress?.label ?? job.state)}
					</p>
				) : null}
				{!job && items.length > MAX_TASK_SUGGESTION_ITEMS ? (
					<p role="alert" className="task-warning">
						Select at most {MAX_TASK_SUGGESTION_ITEMS} Items for Task suggestions. Close this dialog
						and narrow your selection.
					</p>
				) : null}
				<div className="task-form">
					{choices.map((choice) => (
						<div key={choice.index} className="task-suggestion">
							<label>
								<span>
									<input
										type="checkbox"
										checked={selected.includes(choice.index)}
										disabled={result?.accepted.includes(choice.index)}
										onChange={(event) =>
											setSelected(
												event.target.checked
													? [...selected, choice.index]
													: selected.filter((index) => index !== choice.index),
											)
										}
									/>{" "}
									Add this Task
								</span>
							</label>
							<label>
								Title
								<input
									aria-label={`Suggestion ${choice.index + 1} title`}
									value={choice.title}
									onChange={(event) =>
										setChoices(
											choices.map((each) =>
												each.index === choice.index ? { ...each, title: event.target.value } : each,
											),
										)
									}
								/>
							</label>
							<div className="task-fields">
								{(
									[
										["plannedDate", "Planned date"],
										["deadline", "Deadline"],
									] as const
								).map(([field, label]) => (
									<label key={field}>
										{label}
										<input
											type="date"
											value={choice[field] ?? ""}
											onInput={(event) =>
												setChoices(
													choices.map((each) =>
														each.index === choice.index
															? { ...each, [field]: event.currentTarget.value || null }
															: each,
													),
												)
											}
										/>
									</label>
								))}
							</div>
							{choice.plannedDate && choice.deadline && choice.plannedDate > choice.deadline ? (
								<p className="task-warning">Planned after deadline.</p>
							) : null}
							<TaskSuggestionLinks
								items={items}
								itemIds={choice.itemIds}
								onChange={(itemIds) =>
									setChoices((current) =>
										current.map((each) =>
											each.index === choice.index ? { ...each, itemIds } : each,
										),
									)
								}
							/>
						</div>
					))}
				</div>
				{result && choices.length === 0 ? <p>No additional Tasks suggested.</p> : null}
				{error ? (
					<p role="alert" className="error">
						{error}
					</p>
				) : null}
				<div className="dialog-actions">
					<Button variant="ghost" disabled={busy} onClick={onClose}>
						Close
					</Button>
					{job && isActiveJob(job) ? (
						<Button
							onClick={() => {
								void api.abort({ id: job.id }).catch((cause) => setError(String(cause)));
							}}
						>
							Stop
						</Button>
					) : !job ? (
						<Button
							variant="primary"
							disabled={busy || items.length > MAX_TASK_SUGGESTION_ITEMS}
							onClick={() => void start()}
						>
							Generate suggestions
						</Button>
					) : result ? (
						<Button
							variant="primary"
							disabled={
								busy ||
								selected.length === 0 ||
								choices.some((choice) => selected.includes(choice.index) && !choice.title.trim())
							}
							onClick={() => void accept()}
						>
							Add {selected.length} {selected.length === 1 ? "Task" : "Tasks"}
						</Button>
					) : null}
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
