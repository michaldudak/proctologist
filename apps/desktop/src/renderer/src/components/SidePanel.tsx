import { Badge } from "@cloudflare/kumo";
import { ArrowSquareOutIcon, XIcon } from "@phosphor-icons/react";
import { AGENT_LABELS, type Assessment, type Priority } from "@proctologist/core/browser";
import type { Job, PullRequestDetail } from "../../../shared/ipc.js";
import {
	absoluteDate,
	areaLabel,
	checksLabel,
	effortLabel,
	nextActionLabel,
	priorityLabel,
	refreshedAt,
	relevanceLabel,
	reviewDecisionLabel,
	shortDuration,
	statusLabel,
} from "../lib/format.js";
import { Markers } from "./Markers.js";
import { NoteEditor } from "./NoteEditor.js";
import { PanelActions, PanelJobStatus, type PanelActionHandlers } from "./PanelActions.js";
import { Tool } from "./Tool.js";
import { Tooltip } from "./Tooltip.js";
import { ReviewDraftSection } from "./ReviewDraftSection.js";
import { PRIORITY_ICONS } from "./VerdictGlyphs.js";

interface SidePanelProps {
	detail: PullRequestDetail | undefined;
	loading: boolean;
	error: string | undefined;
	/** A job running for this pull request, so its actions can wait their turn. */
	job: Job | undefined;
	hasClone: boolean;
	/** Effort levels the review profile's agent and model accept. */
	efforts: { effort: string; description: string }[];
	/** The review profile's effort, or nothing when the agent decides. */
	defaultEffort: string | undefined;
	/** What to call the agent's own choice in the effort menu. */
	agentLabel: string;
	actions: PanelActionHandlers;
	onSetNote: (text: string) => void;
	onCopy: (text: string) => void;
	onOpenOnGitHub: (url: string) => void;
	onClose: () => void;
}

export function SidePanel({
	detail,
	loading,
	error,
	job,
	hasClone,
	efforts,
	defaultEffort,
	agentLabel,
	actions,
	onSetNote,
	onCopy,
	onOpenOnGitHub,
	onClose,
}: SidePanelProps): React.JSX.Element {
	if (error !== undefined) {
		return (
			<aside className="panel">
				<p className="panel-section error">{error}</p>
			</aside>
		);
	}
	if (!detail) {
		return (
			<aside className="panel">
				<p className="panel-section">{loading ? "Loading…" : "Nothing selected."}</p>
			</aside>
		);
	}

	const { pullRequest, assessment } = detail;
	const verdict = assessment?.verdict;

	return (
		<aside className="panel" aria-label={`Pull request ${String(pullRequest.number)}`}>
			<div className="panel-header">
				<div className="panel-tools">
					<span className="cell-number">
						<a href={pullRequest.url} onClick={link(pullRequest.url, onOpenOnGitHub)}>
							#{pullRequest.number}
						</a>
					</span>
					<Markers row={detail} />
					<span className="header-spacer" />
					<Tool
						icon={ArrowSquareOutIcon}
						label="Open on GitHub"
						disabled={false}
						onClick={() => onOpenOnGitHub(pullRequest.url)}
					/>
					<Tool icon={XIcon} label="Close the panel" disabled={false} onClick={onClose} />
				</div>
				<h2 className="panel-title">{pullRequest.title}</h2>
				<div className="panel-verdict">
					{verdict ? (
						<span className="panel-next-action">
							<span className="panel-next-action-label">Next action:</span>{" "}
							{nextActionLabel(verdict.nextAction)}
						</span>
					) : null}
					{verdict?.priority ? <PriorityBadge priority={verdict.priority} /> : null}
					{detail.derived.quickWin ? <Badge variant="teal-subtle">Quick win</Badge> : null}
					{assessment?.depth === "thorough" ? <Badge variant="outline">Thorough</Badge> : null}
					{detail.derived.assessmentOutdated ? (
						<Badge variant="warning">Assessed against an older version</Badge>
					) : null}
				</div>
				<div className="panel-tools panel-tools-actions">
					<PanelActions
						detail={detail}
						job={job}
						handlers={actions}
						hasClone={hasClone}
						efforts={efforts}
						defaultEffort={defaultEffort}
						agentLabel={agentLabel}
					/>
				</div>
				<PanelJobStatus job={job} assessing={detail.assessing} />
			</div>

			{verdict ? (
				<>
					<section className="panel-section">
						<h3>Summary</h3>
						<p>{verdict.summary}</p>
						<dl className="panel-reasons">
							<Reason
								term="Next action"
								judged={nextActionLabel(verdict.nextAction)}
								value={verdict.nextActionReason}
							/>
							{verdict.priority ? (
								<Reason
									term="Priority"
									judged={priorityLabel(verdict.priority)}
									value={verdict.priorityReason}
								/>
							) : null}
							<Reason
								term="Relevance"
								judged={relevanceLabel(verdict.relevance)}
								value={verdict.relevanceReason}
							/>
							<Reason
								term="Status"
								judged={statusLabel(verdict.status)}
								value={verdict.statusReason}
							/>
							<Reason
								term="Effort"
								judged={effortLabel(verdict.effort)}
								value={verdict.effortReason}
							/>
						</dl>
					</section>

					{verdict.evidence.length > 0 ? (
						<section className="panel-section">
							<h3>What {who(assessment)} checked</h3>
							<ul className="panel-evidence">
								{verdict.evidence.map((item) => (
									<li key={item.note}>
										{item.url ? (
											<a href={item.url} onClick={link(item.url, onOpenOnGitHub)}>
												{item.note}
											</a>
										) : (
											item.note
										)}
									</li>
								))}
							</ul>
						</section>
					) : null}
				</>
			) : (
				<section className="panel-section">
					<h3>Not assessed</h3>
					<p className={assessment?.error ? "error" : undefined}>
						{assessment?.error ?? "This pull request has not been assessed yet."}
					</p>
				</section>
			)}

			<section className="panel-section">
				<h3>Private note</h3>
				<NoteEditor number={pullRequest.number} text={detail.note?.text ?? ""} onSave={onSetNote} />
			</section>

			{detail.reviewDraft && detail.reviewDraftMarkdown !== null ? (
				<ReviewDraftSection
					draft={detail.reviewDraft}
					markdown={detail.reviewDraftMarkdown}
					onCopy={onCopy}
					onOpenOnGitHub={onOpenOnGitHub}
					pullRequestUrl={pullRequest.url}
				/>
			) : null}

			<section className="panel-section">
				<h3>Facts</h3>
				<Tooltip
					content={absoluteDate(pullRequest.fetchedAt)}
					render={<p className="panel-section-note" />}
				>
					As of {refreshedAt(pullRequest.fetchedAt)}. GitHub may have moved on since.
				</Tooltip>
				<dl className="panel-facts">
					<dt>Author</dt>
					<dd>
						{pullRequest.author}
						{pullRequest.isBot ? " (bot)" : ""}
					</dd>
					<dt>Area</dt>
					<dd>{verdict ? areaLabel(verdict.area) : "—"}</dd>
					<dt>Opened</dt>
					<Tooltip content={absoluteDate(pullRequest.createdAt)} render={<dd />}>
						{shortDuration(detail.derived.ageDays)} ago
					</Tooltip>
					<dt>Last activity</dt>
					<Tooltip content={absoluteDate(pullRequest.lastActivityAt)} render={<dd />}>
						{shortDuration(detail.derived.lastActivityDays)} ago
						{pullRequest.lastActivityBy ? ` by ${pullRequest.lastActivityBy}` : ""}
					</Tooltip>
					<dt>Size</dt>
					<dd>
						+{pullRequest.additions} −{pullRequest.deletions} across {pullRequest.changedFiles}{" "}
						files
					</dd>
					<dt>Base</dt>
					<dd>{pullRequest.baseRef}</dd>
					<dt>Checks</dt>
					<dd>{checksLabel(pullRequest.checks)}</dd>
					<dt>Mergeable</dt>
					<dd>{pullRequest.mergeable === "CONFLICTING" ? "Conflicts" : "Yes"}</dd>
					{reviewDecisionLabel(pullRequest.reviewDecision) ? (
						<>
							<dt>Review</dt>
							<dd>{reviewDecisionLabel(pullRequest.reviewDecision)}</dd>
						</>
					) : null}
					{pullRequest.labels.length > 0 ? (
						<>
							<dt>Labels</dt>
							<dd>{pullRequest.labels.join(", ")}</dd>
						</>
					) : null}
				</dl>
			</section>

			{detail.history.length > 0 ? (
				<section className="panel-section">
					<h3>Assessment history</h3>
					<div className="panel-history">
						{detail.history.map((entry, index) => (
							<HistoryEntry key={entry.id} entry={entry} previous={detail.history[index + 1]} />
						))}
					</div>
				</section>
			) : null}
		</aside>
	);
}

/**
 * One judged field: what the agent decided, as a heading, and why, in full width below it. The
 * reasons are sentences, and a sentence squeezed beside a label reads like a footnote.
 */
function Reason({
	term,
	judged,
	value,
}: {
	term: string;
	judged: string;
	value: string;
}): React.JSX.Element {
	return (
		<div className="panel-reason">
			<dt>
				<span className="panel-reason-term">{term}</span>
				<span className="panel-reason-judged">{judged}</span>
			</dt>
			<dd>{value}</dd>
		</div>
	);
}

function HistoryEntry({
	entry,
	previous,
}: {
	entry: Assessment;
	previous: Assessment | undefined;
}): React.JSX.Element {
	const changes = changedFields(entry, previous);

	return (
		<div className="history-entry">
			<span className="history-when">
				{absoluteDate(entry.createdAt)} · {entry.depth}
				{entry.durationMs === null ? "" : ` · ${String(Math.round(entry.durationMs / 1000))}s`}
			</span>
			{entry.verdict ? (
				<span>{entry.verdict.summary}</span>
			) : (
				<span className="error">{entry.error ?? "No assessment"}</span>
			)}
			{changes.length > 0 ? (
				<span className="history-changes">
					{changes.map((change) => (
						<Badge key={change} variant="outline">
							{change}
						</Badge>
					))}
				</span>
			) : null}
		</div>
	);
}

function changedFields(entry: Assessment, previous: Assessment | undefined): string[] {
	if (!entry.verdict || !previous?.verdict) {
		return [];
	}
	const before = previous.verdict;
	const after = entry.verdict;
	const changes: string[] = [];
	if (before.nextAction !== after.nextAction) {
		changes.push(`next action was ${before.nextAction}`);
	}
	if (before.status !== after.status) {
		changes.push(`status was ${statusLabel(before.status)}`);
	}
	if (before.relevance !== after.relevance) {
		changes.push(`relevance was ${relevanceLabel(before.relevance)}`);
	}
	if (before.effort !== after.effort) {
		changes.push(`effort was ${before.effort}`);
	}
	if (before.priority !== after.priority && before.priority !== null) {
		changes.push(`priority was ${priorityLabel(before.priority)}`);
	}
	return changes;
}

/**
 * The priority sits with the next action at the top, since the two together are the answer to
 * "what do I do about this, and how soon". The tones match the glyph in the table's column.
 */
function PriorityBadge({ priority }: { priority: Priority }): React.JSX.Element {
	const Symbol = PRIORITY_ICONS[priority];
	return (
		<Badge variant={PRIORITY_BADGES[priority]}>
			<Symbol size={12} weight="bold" aria-hidden />
			{priorityLabel(priority)}
		</Badge>
	);
}

const PRIORITY_BADGES: Record<Priority, "error" | "warning" | "secondary" | "outline"> = {
	critical: "error",
	high: "warning",
	medium: "secondary",
	low: "outline",
};

/** Links inside the panel go to the browser, not to a navigation inside the app window. */
function link(url: string, open: (url: string) => void) {
	return (event: React.MouseEvent): void => {
		event.preventDefault();
		open(url);
	};
}

/** Assessments made before the app had more than one agent do not say which one made them. */
function who(assessment: Assessment | null | undefined): string {
	return assessment?.agent ? AGENT_LABELS[assessment.agent] : "the agent";
}
