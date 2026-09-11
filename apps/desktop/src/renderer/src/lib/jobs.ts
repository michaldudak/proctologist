import type { Job } from "../../../shared/ipc.js";
import { formattingLocale } from "./locale.js";

export function isActiveJob(job: Job): boolean {
	return job.state === "queued" || job.state === "running";
}

/**
 * The words a job is described in. A job kind is the same for both kinds of item — what it works
 * through is `item_kind` — so every line about one has to ask which it is holding, or a triage run
 * reads as an assessment of pull requests.
 */
function words(job: Job): {
	verb: string;
	verbing: string;
	done: string;
	undone: string;
	noun: string;
	nouns: string;
} {
	return job.itemKind === "issue"
		? {
				verb: "Triage",
				verbing: "Triaging",
				done: "triaged",
				undone: "untriaged",
				noun: "issue",
				nouns: "issues",
			}
		: {
				verb: "Assess",
				verbing: "Assessing",
				done: "assessed",
				undone: "unassessed",
				noun: "pull request",
				nouns: "pull requests",
			};
}

/** What the job is, in the words the user would use: "Assess 12 pull requests". */
export function jobTitle(job: Job): string {
	const { verb, noun, nouns } = words(job);
	switch (job.kind) {
		case "refresh": {
			return "Refresh";
		}
		case "assessment": {
			if (job.number !== null) {
				return `${verb} #${String(job.number)}`;
			}
			const total = job.progress?.total;
			return total === undefined
				? `${verb} ${nouns}`
				: `${verb} ${String(total)} ${total === 1 ? noun : nouns}`;
		}
		case "thorough_assessment": {
			return `${verb} #${String(job.number ?? "?")} thoroughly`;
		}
		case "review_draft": {
			return `Draft a review of #${String(job.number ?? "?")}`;
		}
		default: {
			return job.kind;
		}
	}
}

/**
 * Where the job has got to, or how it ended. A finished assessment says what came of it rather than
 * repeating its last progress line; a failed job says why.
 */
export function jobStatus(job: Job): string {
	const progress = job.progress;
	switch (job.state) {
		case "queued": {
			return "Waiting its turn";
		}
		case "running": {
			return progress?.label ?? "Running…";
		}
		case "failed": {
			return job.error ?? "Failed";
		}
		case "aborted": {
			if (job.kind === "assessment" && progress) {
				return `Stopped after ${String(progress.done)} of ${String(progress.total)}${outcome(job, progress, ", ")}`;
			}
			return "Stopped";
		}
		default: {
			if (job.kind === "assessment" && progress) {
				return outcome(job, progress, "") || `Nothing to ${words(job).verb.toLowerCase()}`;
			}
			return progress?.label ?? "Done";
		}
	}
}

/** "11 assessed, 1 unassessed", for the items a job has got through. */
function outcome(job: Job, progress: NonNullable<Job["progress"]>, prefix: string): string {
	const { done, undone } = words(job);
	const failed = progress.failed ?? 0;
	const judged = progress.done - failed;
	const parts = [
		judged > 0 ? `${String(judged)} ${done}` : null,
		failed > 0 ? `${String(failed)} ${undone}` : null,
	].filter((part): part is string => part !== null);
	return parts.length === 0 ? "" : `${prefix}${parts.join(", ")}`;
}

/**
 * The one line the header has room for: what the app is doing right now. One job reads as itself;
 * more than one is counted, and the panel says which.
 */
export function activitySummary(jobs: Job[]): string | null {
	const active = jobs.filter(isActiveJob);
	if (active.length === 0) {
		return null;
	}
	const running = active.filter((job) => job.state === "running");
	if (active.length === 1) {
		const [job] = active;
		return job && job.state === "running" ? shortStatus(job) : "Queued";
	}
	if (running.length === 1 && running[0]) {
		return `${shortStatus(running[0])} · ${String(active.length - 1)} queued`;
	}
	return `${String(active.length)} jobs`;
}

function shortStatus(job: Job): string {
	const progress = job.progress;
	const { verbing } = words(job);
	switch (job.kind) {
		case "refresh": {
			return "Fetching…";
		}
		case "assessment": {
			return progress
				? `${verbing} ${String(progress.done)} of ${String(progress.total)}`
				: `${verbing}…`;
		}
		case "thorough_assessment": {
			return `${verbing} thoroughly…`;
		}
		case "review_draft": {
			return "Drafting a review…";
		}
		default: {
			return "Running…";
		}
	}
}

/** Whole minutes and seconds between two instants, the way a stopwatch would read them. */
export function elapsed(from: string, to: string): string {
	const seconds = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));
	if (seconds < 60) {
		return `${String(seconds)} s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${String(minutes)} min`;
	}
	const hours = Math.floor(minutes / 60);
	return `${String(hours)} h ${String(minutes % 60)} min`;
}

export function clockTime(iso: string): string {
	return new Date(iso).toLocaleTimeString(formattingLocale(), { timeStyle: "short" });
}
