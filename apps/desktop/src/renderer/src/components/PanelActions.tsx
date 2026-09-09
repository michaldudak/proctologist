import { Button, Select } from "@cloudflare/kumo";
import { useState } from "react";
import { REASONING_EFFORTS, type ReasoningEffort } from "@proctologist/core/browser";
import type { Job, PullRequestDetail } from "../../../shared/ipc.js";

export interface PanelActionHandlers {
	reassess: () => void;
	assessThorough: () => void;
	draftReview: (effort: ReasoningEffort) => void;
	snooze: (until?: string) => void;
	unsnooze: () => void;
}

interface PanelActionsProps {
	detail: PullRequestDetail;
	/** A job already running for this pull request; its buttons stay out of the way while it does. */
	job: Job | undefined;
	busy: boolean;
	handlers: PanelActionHandlers;
	hasClone: boolean;
}

const SNOOZE_OPTIONS = {
	change: "until it changes",
	week: "for a week",
	month: "for a month",
} as const;

export function PanelActions({
	detail,
	job,
	busy,
	handlers,
	hasClone,
}: PanelActionsProps): React.JSX.Element {
	const [effort, setEffort] = useState<ReasoningEffort>("high");
	const [snoozeFor, setSnoozeFor] = useState<keyof typeof SNOOZE_OPTIONS>("change");
	const running = job !== undefined || busy;

	return (
		<section className="panel-section">
			<h3>Actions</h3>
			{job ? (
				<span className="header-meta" aria-live="polite">
					{describe(job)}
				</span>
			) : null}

			<div className="filter-row">
				<Button size="xs" disabled={running} onClick={handlers.reassess}>
					Re-assess
				</Button>
				<Button
					size="xs"
					disabled={running || !hasClone}
					title={hasClone ? undefined : "Needs a local clone"}
					onClick={handlers.assessThorough}
				>
					Assess thoroughly
				</Button>
			</div>

			<div className="filter-row">
				<Button
					size="xs"
					disabled={running || !hasClone}
					title={hasClone ? undefined : "Needs a local clone"}
					onClick={() => handlers.draftReview(effort)}
				>
					Draft a review
				</Button>
				<Select
					size="xs"
					aria-label="Review effort"
					value={effort}
					onValueChange={(value) => setEffort((value as ReasoningEffort | null) ?? "high")}
					items={Object.fromEntries(REASONING_EFFORTS.map((level) => [level, level]))}
				/>
			</div>

			<div className="filter-row">
				{detail.snooze === null ? (
					<>
						<Button size="xs" variant="ghost" onClick={() => handlers.snooze(until(snoozeFor))}>
							Snooze
						</Button>
						<Select
							size="xs"
							aria-label="Snooze for how long"
							value={snoozeFor}
							onValueChange={(value) =>
								setSnoozeFor((value as keyof typeof SNOOZE_OPTIONS | null) ?? "change")
							}
							items={SNOOZE_OPTIONS}
						/>
					</>
				) : (
					<Button size="xs" variant="ghost" onClick={handlers.unsnooze}>
						Unsnooze
					</Button>
				)}
			</div>
		</section>
	);
}

function until(option: keyof typeof SNOOZE_OPTIONS): string | undefined {
	if (option === "change") {
		return undefined;
	}
	const days = option === "week" ? 7 : 30;
	return new Date(Date.now() + days * 86_400_000).toISOString();
}

function describe(job: Job): string {
	const progress = job.progress;
	const what = job.kind === "review_draft" ? "Drafting a review" : "Assessing thoroughly";
	if (job.state === "queued") {
		return `${what}: queued`;
	}
	return progress?.label ?? `${what}…`;
}
