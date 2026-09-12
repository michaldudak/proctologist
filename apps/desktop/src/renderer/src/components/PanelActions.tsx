import { DropdownMenu } from "@cloudflare/kumo";
import {
	ArrowsClockwiseIcon,
	BellIcon,
	BellZIcon,
	CircleNotchIcon,
	EnvelopeSimpleIcon,
	EnvelopeSimpleOpenIcon,
	MicroscopeIcon,
	NotePencilIcon,
} from "@phosphor-icons/react";
import type { EffortLevel } from "@proctologist/core/browser";
import type { Job, PullRequestDetail, RowActivity } from "../../../shared/ipc.js";
import { Tool, ToolMenu } from "./Tool.js";

export interface PanelActionHandlers {
	reassess: () => void;
	assessThorough: () => void;
	/** Nothing means the review profile's own effort, which may itself be left to the agent. */
	draftReview: (effort: EffortLevel | undefined) => void;
	snooze: (until?: string) => void;
	unsnooze: () => void;
	markViewed: () => void;
	clearViewed: () => void;
}

interface PanelActionsProps {
	detail: PullRequestDetail;
	/** A job already running for this pull request; its buttons stay out of the way while it does. */
	job: Job | undefined;
	handlers: PanelActionHandlers;
	hasClone: boolean;
	/** Effort levels the review profile's agent and model accept. */
	efforts: { effort: string; description: string }[];
	/** The review profile's effort, or nothing when the agent decides. */
	defaultEffort: string | undefined;
	agentLabel: string;
}

const SNOOZE_OPTIONS = {
	change: "Until it changes",
	week: "For a week",
	month: "For a month",
} as const;

const NEEDS_CLONE = "Needs a local clone";

/**
 * The panel's actions, as a row of icons in its header. They are the same commands whatever
 * pull request is selected, so they belong where they can be found without reading — and the panel
 * below them is for reading.
 */
export function PanelActions({
	detail,
	job,
	handlers,
	hasClone,
	efforts,
	defaultEffort,
	agentLabel,
}: PanelActionsProps): React.JSX.Element {
	// A job about this pull request alone, or a run through the whole list that has it in hand.
	const running = job !== undefined || detail.activity !== null;

	return (
		<>
			<Tool
				icon={ArrowsClockwiseIcon}
				label="Re-assess"
				disabled={running}
				onClick={handlers.reassess}
			/>
			<Tool
				icon={MicroscopeIcon}
				label="Assess thoroughly"
				note={hasClone ? undefined : NEEDS_CLONE}
				disabled={running || !hasClone}
				onClick={handlers.assessThorough}
			/>

			<ToolMenu
				icon={NotePencilIcon}
				label="Draft a review"
				note={hasClone ? undefined : NEEDS_CLONE}
				disabled={running || !hasClone}
			>
				<DropdownMenu.Item
					selected={defaultEffort === undefined}
					onClick={() => handlers.draftReview(undefined)}
				>
					{agentLabel} default
				</DropdownMenu.Item>
				{efforts.map((level) => (
					<DropdownMenu.Item
						key={level.effort}
						selected={level.effort === defaultEffort}
						onClick={() => handlers.draftReview(level.effort)}
					>
						{level.effort}
						{level.description ? ` — ${level.description}` : ""}
					</DropdownMenu.Item>
				))}
			</ToolMenu>

			{detail.derived.viewed ? (
				<Tool
					icon={EnvelopeSimpleIcon}
					label="Mark as not viewed"
					disabled={false}
					onClick={handlers.clearViewed}
				/>
			) : (
				<Tool
					icon={EnvelopeSimpleOpenIcon}
					label="Mark as viewed"
					disabled={false}
					onClick={handlers.markViewed}
				/>
			)}

			{detail.snooze === null ? (
				<ToolMenu icon={BellZIcon} label="Snooze" disabled={false}>
					{Object.entries(SNOOZE_OPTIONS).map(([option, label]) => (
						<DropdownMenu.Item
							key={option}
							onClick={() => handlers.snooze(until(option as keyof typeof SNOOZE_OPTIONS))}
						>
							{label}
						</DropdownMenu.Item>
					))}
				</ToolMenu>
			) : (
				<Tool icon={BellIcon} label="Unsnooze" disabled={false} onClick={handlers.unsnooze} />
			)}
		</>
	);
}

/** The line that says what the agent is doing, for the whole time it is doing it. */
export function PanelJobStatus({
	job,
	activity,
}: {
	job: Job | undefined;
	activity: RowActivity | null;
}): React.JSX.Element | null {
	const text = job ? describe(job) : activity ? describeActivity(activity) : null;
	if (text === null) {
		return null;
	}
	// The icon turns only while the agent is at work; waiting its turn is a still line.
	const working = job ? job.state === "running" : activity?.state === "running";
	return (
		<span className="header-meta panel-job-status" aria-live="polite">
			{working ? (
				<CircleNotchIcon size={13} weight="bold" className="spinning" aria-hidden />
			) : null}
			{text}
		</span>
	);
}

function until(option: keyof typeof SNOOZE_OPTIONS): string | undefined {
	if (option === "change") {
		return undefined;
	}
	const days = option === "week" ? 7 : 30;
	return new Date(Date.now() + days * 86_400_000).toISOString();
}

const WHAT: Record<Job["kind"], string> = {
	refresh: "Refreshing",
	assessment: "Assessing",
	thorough_assessment: "Assessing thoroughly",
	review_draft: "Drafting a review",
};

function describe(job: Job): string {
	const what = WHAT[job.kind];
	if (job.state === "queued") {
		return `${what}: waiting its turn`;
	}
	return `${what}…`;
}

/** The same line, from what the row knows, for a job the jobs list has not caught up with. */
function describeActivity(activity: RowActivity): string {
	const what = WHAT[activity.kind];
	return activity.state === "queued" ? `${what}: waiting its turn` : `${what}…`;
}
