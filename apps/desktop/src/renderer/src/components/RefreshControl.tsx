import { Button } from "@cloudflare/kumo";
import type { Job, RepositorySummary } from "../../../shared/ipc.js";
import { jobTitle } from "../lib/jobs.js";
import { Tooltip } from "./Tooltip.js";

interface RefreshControlProps {
	repository: RepositorySummary | undefined;
	/** The refresh or batch of assessments under way for this repository, if any. */
	job: Job | undefined;
	showRefreshAll: boolean;
	onRefresh: () => void;
	onRefreshAll: () => void;
	/** Assess what the last refresh left due, or with `full` every open pull request. */
	onAssess: (full: boolean) => void;
	onAbort: (id: string) => void;
}

/**
 * Refreshing is cheap and happens on its own in the background; assessing costs agent time and
 * only ever happens when asked. The buttons say which is which.
 */
export function RefreshControl({
	repository,
	job,
	showRefreshAll,
	onRefresh,
	onRefreshAll,
	onAssess,
	onAbort,
}: RefreshControlProps): React.JSX.Element | null {
	if (!repository) {
		return null;
	}

	if (job) {
		return (
			<>
				<span className="header-meta" aria-live="polite">
					{describe(job)}
				</span>
				<Button size="xs" variant="secondary-destructive" onClick={() => onAbort(job.id)}>
					Stop
				</Button>
			</>
		);
	}

	const due = repository.due;
	return (
		<>
			{showRefreshAll ? (
				<Tooltip
					content="Fetch the open pull requests of every tracked repository, without assessing any"
					render={<Button size="xs" variant="ghost" onClick={onRefreshAll} />}
				>
					Refresh all
				</Tooltip>
			) : null}
			<Tooltip
				content="Fetch this repository's open pull requests, without assessing any"
				render={<Button size="xs" variant="ghost" onClick={onRefresh} />}
			>
				Refresh
			</Tooltip>
			<Tooltip
				content="Re-assess every open pull request, not only the ones that changed"
				render={<Button size="xs" variant="ghost" onClick={() => onAssess(true)} />}
			>
				Re-assess all
			</Tooltip>
			<Tooltip
				content={
					due === 0
						? "Every open pull request has a current assessment"
						: "Assess the pull requests that are new, changed, or whose assessment is outdated"
				}
				render={
					<Button
						size="xs"
						variant="primary"
						disabled={due === 0}
						onClick={() => onAssess(false)}
					/>
				}
			>
				{due === 0 ? "Nothing due" : `Assess ${String(due)} due`}
			</Tooltip>
		</>
	);
}

function describe(job: Job): string {
	if (job.state === "queued") {
		return `${jobTitle(job)}: queued…`;
	}
	const progress = job.progress;
	if (!progress) {
		return job.kind === "refresh" ? "Fetching…" : `${jobTitle(job)}…`;
	}
	return progress.label ?? `${String(progress.done)} of ${String(progress.total)}`;
}
