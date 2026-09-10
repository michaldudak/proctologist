import type { Job } from "../../../shared/ipc.js";
import { formattingLocale } from "./locale.js";

export function isActiveJob(job: Job): boolean {
	return job.state === "queued" || job.state === "running";
}

/** What the job is, in the words the user would use: "Assess 12 pull requests". */
export function jobTitle(job: Job): string {
	switch (job.kind) {
		case "refresh": {
			return "Refresh";
		}
		case "assessment": {
			if (job.number !== null) {
				return `Assess #${String(job.number)}`;
			}
			const total = job.progress?.total;
			return total === undefined
				? "Assess pull requests"
				: `Assess ${String(total)} pull request${total === 1 ? "" : "s"}`;
		}
		case "thorough_assessment": {
			return `Assess #${String(job.number ?? "?")} thoroughly`;
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
				return `Stopped after ${String(progress.done)} of ${String(progress.total)}${outcome(progress, ", ")}`;
			}
			return "Stopped";
		}
		default: {
			if (job.kind === "assessment" && progress) {
				return outcome(progress, "") || "Nothing to assess";
			}
			return progress?.label ?? "Done";
		}
	}
}

/** "11 assessed, 1 unassessed", for the pull requests an assessment job has got through. */
function outcome(progress: NonNullable<Job["progress"]>, prefix: string): string {
	const failed = progress.failed ?? 0;
	const assessed = progress.done - failed;
	const parts = [
		assessed > 0 ? `${String(assessed)} assessed` : null,
		failed > 0 ? `${String(failed)} unassessed` : null,
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
	switch (job.kind) {
		case "refresh": {
			return "Fetching…";
		}
		case "assessment": {
			return progress
				? `Assessing ${String(progress.done)} of ${String(progress.total)}`
				: "Assessing…";
		}
		case "thorough_assessment": {
			return "Assessing thoroughly…";
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
