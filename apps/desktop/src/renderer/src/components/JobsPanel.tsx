import { Button, Popover } from "@cloudflare/kumo";
import {
	CheckCircleIcon,
	CircleNotchIcon,
	HourglassIcon,
	ProhibitIcon,
	PulseIcon,
	WarningCircleIcon,
	type Icon,
} from "@phosphor-icons/react";
import type { Job } from "../../../shared/ipc.js";
import {
	activitySummary,
	clockTime,
	elapsed,
	isActiveJob,
	jobStatus,
	jobTitle,
} from "../lib/jobs.js";
import { Tooltip } from "./Tooltip.js";

interface JobsPanelProps {
	/** Every job of this session, newest first. */
	jobs: Job[];
	/** True when more than one repository is tracked, so a job has to say which it is for. */
	showRepository: boolean;
	onAbort: (id: string) => void;
}

/**
 * What the app is doing, and what it has done since it started. The header button carries the one
 * line worth reading at a glance; the panel behind it has the rest, running jobs first.
 */
export function JobsPanel({ jobs, showRepository, onAbort }: JobsPanelProps): React.JSX.Element {
	const active = jobs.filter(isActiveJob);
	const finished = jobs.filter((job) => !isActiveJob(job));
	const summary = activitySummary(jobs);

	return (
		<Popover>
			<Tooltip content="Jobs" render={<span />}>
				<Popover.Trigger
					render={
						<button
							type="button"
							className="jobs-trigger"
							aria-label={summary === null ? "Jobs" : `Jobs: ${summary}`}
							data-active={active.length > 0}
						/>
					}
				>
					{active.some((job) => job.state === "running") ? (
						<CircleNotchIcon size={15} weight="bold" aria-hidden className="spinning" />
					) : (
						<PulseIcon size={15} weight="bold" aria-hidden />
					)}
					{summary === null ? null : (
						<span className="jobs-trigger-text" aria-live="polite">
							{summary}
						</span>
					)}
				</Popover.Trigger>
			</Tooltip>
			<Popover.Content align="end" sideOffset={6} className="jobs-popover">
				<div className="jobs-panel">
					{jobs.length === 0 ? (
						<p className="jobs-empty">Nothing has run since the app started.</p>
					) : null}
					{active.length > 0 ? (
						<section className="jobs-group">
							<h3>In progress</h3>
							{active.map((job) => (
								<JobRow key={job.id} job={job} showRepository={showRepository} onAbort={onAbort} />
							))}
						</section>
					) : null}
					{finished.length > 0 ? (
						<section className="jobs-group">
							<h3>Done this session</h3>
							{finished.map((job) => (
								<JobRow key={job.id} job={job} showRepository={showRepository} onAbort={onAbort} />
							))}
						</section>
					) : null}
				</div>
			</Popover.Content>
		</Popover>
	);
}

const STATE_ICONS: Record<Job["state"], { icon: Icon; label: string }> = {
	queued: { icon: HourglassIcon, label: "Queued" },
	running: { icon: CircleNotchIcon, label: "Running" },
	completed: { icon: CheckCircleIcon, label: "Completed" },
	aborted: { icon: ProhibitIcon, label: "Stopped" },
	failed: { icon: WarningCircleIcon, label: "Failed" },
};

interface JobRowProps {
	job: Job;
	showRepository: boolean;
	onAbort: (id: string) => void;
}

function JobRow({ job, showRepository, onAbort }: JobRowProps): React.JSX.Element {
	const { icon: StateIcon, label } = STATE_ICONS[job.state];
	const progress = job.progress;
	const when = job.finishedAt ?? job.startedAt ?? job.createdAt;
	const fraction =
		job.state === "running" && progress && progress.total > 0
			? progress.done / progress.total
			: null;

	return (
		<div className="job" data-state={job.state}>
			<span className="job-state" title={label}>
				<StateIcon
					size={15}
					weight={job.state === "running" ? "bold" : "fill"}
					aria-hidden
					className={job.state === "running" ? "spinning" : undefined}
				/>
				<span className="visually-hidden">{label}</span>
			</span>
			<span className="job-title">
				{jobTitle(job)}
				{showRepository ? <span className="job-repository"> · {job.repository}</span> : null}
			</span>
			<span className="job-when">
				{clockTime(when)}
				{job.finishedAt && job.startedAt ? ` · ${elapsed(job.startedAt, job.finishedAt)}` : null}
			</span>
			{isActiveJob(job) ? (
				<Button size="xs" variant="secondary-destructive" onClick={() => onAbort(job.id)}>
					Stop
				</Button>
			) : null}
			<span className="job-status">{jobStatus(job)}</span>
			{fraction === null ? null : (
				<span
					className="job-progress"
					role="progressbar"
					aria-valuemin={0}
					aria-valuemax={progress?.total}
					aria-valuenow={progress?.done}
				>
					<span style={{ width: `${String(Math.round(fraction * 100))}%` }} />
				</span>
			)}
		</div>
	);
}
