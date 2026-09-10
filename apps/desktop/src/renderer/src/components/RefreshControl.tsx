import { Button, DropdownMenu } from "@cloudflare/kumo";
import { LightningIcon } from "@phosphor-icons/react";
import type { Job, RepositorySummary } from "../../../shared/ipc.js";
import { jobTitle } from "../lib/jobs.js";
import { ToolMenu } from "./Tool.js";
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
 * only ever happens when asked. The one button is for what the user is here to do, assess what is
 * due. Refreshing by hand and re-assessing everything are rare enough, the first because the
 * scheduler does it and the second because it costs, that they wait in a menu beside it.
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

	// Nothing due means nothing to offer: the button goes away rather than sit there disabled.
	const due = repository.due;
	return (
		<>
			{due === 0 ? null : (
				<Tooltip
					content="Assess the pull requests that are new, changed, or whose assessment is outdated"
					render={<Button size="xs" variant="primary" onClick={() => onAssess(false)} />}
				>
					{`Assess ${String(due)} due`}
				</Tooltip>
			)}
			<ToolMenu
				icon={LightningIcon}
				label="More actions"
				emphasis="plain"
				disabled={false}
				align="end"
			>
				<DropdownMenu.Item onClick={onRefresh}>Refresh</DropdownMenu.Item>
				{showRefreshAll ? (
					<DropdownMenu.Item onClick={onRefreshAll}>Refresh all repositories</DropdownMenu.Item>
				) : null}
				<DropdownMenu.Separator />
				<DropdownMenu.Item onClick={() => onAssess(true)}>
					Re-assess all pull requests
				</DropdownMenu.Item>
			</ToolMenu>
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
