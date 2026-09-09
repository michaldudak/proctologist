import { Button } from "@cloudflare/kumo";
import type { Job, RepositorySummary } from "../../../shared/ipc.js";
import { Tooltip } from "./Tooltip.js";

interface RefreshControlProps {
	repository: RepositorySummary | undefined;
	job: Job | undefined;
	showRefreshAll: boolean;
	onRefresh: (full: boolean) => void;
	onRefreshAll: () => void;
	onAbort: (id: string) => void;
}

export function RefreshControl({
	repository,
	job,
	showRefreshAll,
	onRefresh,
	onRefreshAll,
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

	return (
		<>
			{showRefreshAll ? (
				<Button size="xs" variant="ghost" onClick={onRefreshAll}>
					Refresh all
				</Button>
			) : null}
			<Tooltip
				content="Re-assess every open pull request, not only the ones that changed"
				render={<Button size="xs" variant="ghost" onClick={() => onRefresh(true)} />}
			>
				Re-assess all
			</Tooltip>
			<Button size="xs" variant="primary" onClick={() => onRefresh(false)}>
				Refresh
			</Button>
		</>
	);
}

function describe(job: Job): string {
	if (job.state === "queued") {
		return "Queued…";
	}
	const progress = job.progress;
	if (!progress) {
		return "Fetching…";
	}
	return progress.label ?? `${String(progress.done)} of ${String(progress.total)}`;
}
