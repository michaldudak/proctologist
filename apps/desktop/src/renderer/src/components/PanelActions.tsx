import { DropdownMenu } from "@cloudflare/kumo";
import {
	ArrowsClockwiseIcon,
	BellIcon,
	BellZIcon,
	CircleNotchIcon,
	MicroscopeIcon,
	NotePencilIcon,
} from "@phosphor-icons/react";
import { isPullRequest, type EffortLevel, type ItemKind } from "@proctologist/core/browser";
import type { Job, ItemDetail, RowActivity } from "../../../shared/ipc.js";
import { Tool, ToolMenu } from "./Tool.js";

export interface PanelActionHandlers {
	reassess: () => void;
	assessThorough: () => void;
	/** Nothing means the review profile's own effort, which may itself be left to the agent. */
	draftReview: (effort: EffortLevel | undefined) => void;
	snooze: (until?: string) => void;
	unsnooze: () => void;
}

interface PanelActionsProps {
	detail: ItemDetail;
	/** A job already running for this item; its buttons stay out of the way while it does. */
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
 * The panel's actions, as a row of icons in its header. They belong where they can be found
 * without reading — the panel below them is for reading.
 *
 * Which actions exist follows the kind. A review draft is a pull request's; an issue has no
 * counterpart, so the button is absent rather than present and disabled: there is nothing the user
 * could do to make it apply.
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
	// A job about this item alone, or a run through the whole list that has it in hand.
	const running = job !== undefined || detail.activity !== null;
	const isPr = isPullRequest(detail.item);

	return (
		<>
			<Tool
				icon={ArrowsClockwiseIcon}
				label={isPr ? "Re-assess" : "Re-triage"}
				disabled={running}
				onClick={handlers.reassess}
			/>
			<Tool
				icon={MicroscopeIcon}
				label={isPr ? "Assess thoroughly" : "Triage thoroughly"}
				note={hasClone ? undefined : NEEDS_CLONE}
				disabled={running || !hasClone}
				onClick={handlers.assessThorough}
			/>

			{isPr ? (
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
			) : null}

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
	kind,
}: {
	job: Job | undefined;
	activity: RowActivity | null;
	/** A row's activity says which job has it, not what it is about; the panel knows that part. */
	kind: ItemKind;
}): React.JSX.Element | null {
	const text = job ? describe(job) : activity ? describeActivity(activity, kind) : null;
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

/** What each job kind is doing, in the words of the kind of item it is doing it to. */
function whatItIsDoing(job: Job): string {
	const judging = job.itemKind === "issue" ? "Triaging" : "Assessing";
	switch (job.kind) {
		case "refresh": {
			return "Refreshing";
		}
		case "assessment": {
			return judging;
		}
		case "thorough_assessment": {
			return `${judging} thoroughly`;
		}
		default: {
			return "Drafting a review";
		}
	}
}

function describe(job: Job): string {
	const what = whatItIsDoing(job);
	if (job.state === "queued") {
		return `${what}: waiting its turn`;
	}
	return `${what}…`;
}

/** The same line, from what the row knows, for a job the jobs list has not caught up with. */
function describeActivity(activity: RowActivity, kind: ItemKind): string {
	const what =
		activity.job === "review_draft"
			? "Drafting a review"
			: kind === "issue"
				? "Triaging"
				: "Assessing";
	return activity.state === "queued" ? `${what}: waiting its turn` : `${what}…`;
}
