import { DropdownMenu } from "@cloudflare/kumo";
import {
	ArrowsClockwiseIcon,
	BellIcon,
	BellZIcon,
	MicroscopeIcon,
	NotePencilIcon,
} from "@phosphor-icons/react";
import type { EffortLevel } from "@proctologist/core/browser";
import type { Job, PullRequestDetail } from "../../../shared/ipc.js";
import { Tool, toolTip, type ToolProps } from "./Tool.js";
import { Tooltip } from "./Tooltip.js";

export interface PanelActionHandlers {
	reassess: () => void;
	assessThorough: () => void;
	draftReview: (effort: EffortLevel) => void;
	snooze: (until?: string) => void;
	unsnooze: () => void;
}

interface PanelActionsProps {
	detail: PullRequestDetail;
	/** A job already running for this pull request; its buttons stay out of the way while it does. */
	job: Job | undefined;
	handlers: PanelActionHandlers;
	hasClone: boolean;
	/** Effort levels the review profile's agent and model accept. */
	efforts: { effort: string; description: string }[];
	defaultEffort: string;
}

const SNOOZE_OPTIONS = {
	change: "Until it changes",
	week: "For a week",
	month: "For a month",
} as const;

const NEEDS_CLONE = "Needs a local clone";

/**
 * The panel's actions, as a row of icons in its header. They are the same four commands whatever
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
}: PanelActionsProps): React.JSX.Element {
	const running = job !== undefined;

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

			<Menu
				icon={NotePencilIcon}
				label="Draft a review"
				note={hasClone ? undefined : NEEDS_CLONE}
				disabled={running || !hasClone}
			>
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
			</Menu>

			{detail.snooze === null ? (
				<Menu icon={BellZIcon} label="Snooze" disabled={false}>
					{Object.entries(SNOOZE_OPTIONS).map(([option, label]) => (
						<DropdownMenu.Item
							key={option}
							onClick={() => handlers.snooze(until(option as keyof typeof SNOOZE_OPTIONS))}
						>
							{label}
						</DropdownMenu.Item>
					))}
				</Menu>
			) : (
				<Tool icon={BellIcon} label="Unsnooze" disabled={false} onClick={handlers.unsnooze} />
			)}
		</>
	);
}

/** The line that says what the agent is doing, for the whole time it is doing it. */
export function PanelJobStatus({ job }: { job: Job | undefined }): React.JSX.Element | null {
	if (!job) {
		return null;
	}
	return (
		<span className="header-meta" aria-live="polite">
			{describe(job)}
		</span>
	);
}

function Menu({
	icon: Symbol,
	label,
	note,
	disabled,
	children,
}: Omit<ToolProps, "onClick"> & { children: React.ReactNode }): React.JSX.Element {
	return (
		<Tooltip content={toolTip({ label, note })} render={<span />}>
			<DropdownMenu>
				<DropdownMenu.Trigger
					render={
						<button type="button" className="tool-button" aria-label={label} disabled={disabled}>
							<Symbol size={15} weight="bold" aria-hidden />
						</button>
					}
				/>
				<DropdownMenu.Content>{children}</DropdownMenu.Content>
			</DropdownMenu>
		</Tooltip>
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
