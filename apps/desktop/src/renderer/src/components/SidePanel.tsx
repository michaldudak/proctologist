import { Badge } from "@cloudflare/kumo";
import {
	ArrowSquareOutIcon,
	CaretRightIcon,
	CheckCircleIcon,
	CheckIcon,
	ClockIcon,
	GitMergeIcon,
	NotePencilIcon,
	XCircleIcon,
	XIcon,
	type Icon,
} from "@phosphor-icons/react";
import { useState } from "react";
import {
	AGENT_LABELS,
	isIssue,
	isPullRequest,
	type Assessment,
	type Relevance,
	type ReviewVerdict,
	type StoredItem,
} from "@proctologist/core/browser";
import type { Job } from "../../../shared/ipc.js";
import {
	absoluteDate,
	associationLabel,
	areaLabel,
	checksLabel,
	formatCount,
	nextActionLabel,
	priorityLabel,
	refreshedAt,
	relevanceLabel,
	reviewDecisionLabel,
	shortDuration,
	statusLabel,
	votesLabel,
} from "../lib/format.js";
import { AnalysisSection } from "./AnalysisSection.js";
import { AuthorMark } from "./AuthorMark.js";
import { EffortBadge } from "./EffortBadge.js";
import type { GlyphTone } from "./Glyph.js";
import { Markers } from "./Markers.js";
import { NEXT_ACTION_ICONS } from "./NextAction.js";
import { NoteEditor } from "./NoteEditor.js";
import { PanelActions, PanelJobStatus, type PanelActionHandlers } from "./PanelActions.js";
import { Tool } from "./Tool.js";
import { Tooltip } from "./Tooltip.js";
import { ReviewDraftSection } from "./ReviewDraftSection.js";
import type { ItemListStore } from "../state/ItemListStore.js";
import { useNow } from "../state/useNow.js";
import {
	PRIORITY_ICONS,
	PRIORITY_TONES,
	RELEVANCE_ICONS,
	RELEVANCE_TONES,
} from "./VerdictGlyphs.js";

interface SidePanelProps {
	store: ItemListStore;
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
	/** Posts the review draft on GitHub with the verdict chosen; rejects with what went wrong. */
	onPostReview: (verdict: ReviewVerdict) => Promise<void>;
	onClose: () => void;
}

/**
 * Reads the detail from the store rather than taking it as a prop, so a reload that brings back
 * what is already shown redraws nothing: the scroll position and a note being typed stay put.
 */
export function SidePanel({
	store,
	job,
	hasClone,
	efforts,
	defaultEffort,
	agentLabel,
	actions,
	onSetNote,
	onCopy,
	onOpenOnGitHub,
	onPostReview,
	onClose,
}: SidePanelProps): React.JSX.Element {
	const detail = store.useState("detail");
	const loading = store.useState("detailLoading");
	const error = store.useState("detailError");
	const now = useNow();

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

	const { item, assessment } = detail;
	const verdict = assessment?.verdict;
	// A pull request is assessed and an issue is triaged, and the panel says whichever it is
	// looking at rather than the one it was written for.
	const isPr = isPullRequest(item);
	const noun = isPr ? "pull request" : "issue";
	const reading = { number: item.number, title: item.title, headSha: isPr ? item.headSha : "" };
	const ActionIcon = verdict ? NEXT_ACTION_ICONS[verdict.nextAction] : undefined;

	return (
		<aside
			className="panel"
			aria-label={`${isPr ? "Pull request" : "Issue"} ${String(item.number)}`}
		>
			{/* Which item this is stays put while the rest scrolls; nothing else needs to. */}
			<div className="panel-header">
				<div className="panel-tools">
					<span className="cell-number">
						<a href={item.url} onClick={link(item.url, onOpenOnGitHub)}>
							#{item.number}
						</a>
					</span>
					<Markers row={detail} />
					<span className="header-spacer" />
					<Tool
						icon={ArrowSquareOutIcon}
						label="Open on GitHub"
						disabled={false}
						onClick={() => onOpenOnGitHub(item.url)}
					/>
					<Tool icon={XIcon} label="Close the panel" disabled={false} onClick={onClose} />
				</div>
				<h2 className="panel-title">{item.title}</h2>
			</div>

			{/*
			 * The facts a maintainer places an item by, in one line under its title: who, how old,
			 * how big, and whether anything is red. The rest of what GitHub says waits further down.
			 */}
			<div className="panel-identity">
				<span className="panel-author">
					<AuthorMark item={item} />
					<span>
						{item.author}
						{authorQualifier(item)}
					</span>
				</span>
				<Tooltip content={absoluteDate(item.createdAt)} render={<span />}>
					opened {shortDuration(item.createdAt, now)} ago
				</Tooltip>
				{isPullRequest(item) ? (
					<>
						<span>
							<span className="diff-added">+{formatCount(item.additions)}</span>{" "}
							<span className="diff-removed">−{formatCount(item.deletions)}</span> in{" "}
							{formatCount(item.changedFiles)} {item.changedFiles === 1 ? "file" : "files"}
						</span>
						<Checks checks={item.checks} />
						{item.mergeable === "CONFLICTING" ? (
							<span className="panel-fact toned" data-tone="danger">
								<GitMergeIcon size={13} weight="bold" aria-hidden />
								<span>Conflicts</span>
							</span>
						) : null}
						{reviewDecisionLabel(item.reviewDecision) ? (
							<span>{reviewDecisionLabel(item.reviewDecision)}</span>
						) : null}
					</>
				) : null}
				{isIssue(item) ? <span>{votesLabel(item.upvotes, item.downvotes)}</span> : null}
			</div>

			{/*
			 * The answer the panel is opened for, set apart from everything that explains it: what to
			 * do, why, and the commands that do something about it.
			 */}
			<div className="panel-callout" data-assessed={Boolean(verdict)}>
				{verdict && ActionIcon ? (
					<>
						<div className="panel-callout-caption">
							<span>Next action</span>
							{detail.derived.quickWin ? <Badge variant="teal-subtle">Quick win</Badge> : null}
							{assessment?.depth === "thorough" ? <Badge variant="outline">Thorough</Badge> : null}
							{detail.derived.assessmentOutdated ? (
								<Badge variant="warning">Assessed against an older version</Badge>
							) : null}
						</div>
						<p className="panel-callout-action">
							<ActionIcon size={17} weight="bold" aria-hidden />
							{nextActionLabel(verdict.nextAction)}
						</p>
						<p>{verdict.nextActionReason}</p>
					</>
				) : (
					<>
						<p className="panel-callout-action">{isPr ? "Not assessed" : "Not triaged"}</p>
						<p className={assessment?.error ? "error" : undefined}>
							{assessment?.error ??
								`This ${noun} has not been ${isPr ? "assessed" : "triaged"} yet.`}
						</p>
					</>
				)}
				<div className="panel-callout-foot">
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
					<PanelJobStatus job={job} activity={detail.activity} kind={item.kind} />
				</div>
			</div>

			{verdict ? (
				<section className="panel-section">
					<p className="panel-lead">{verdict.summary}</p>
					<dl className="panel-signals">
						{verdict.priority ? (
							<Signal
								term="Priority"
								icon={PRIORITY_ICONS[verdict.priority]}
								tone={PRIORITY_TONES[verdict.priority]}
								judged={priorityLabel(verdict.priority)}
								reason={verdict.priorityReason}
							/>
						) : null}
						<Signal
							term="Relevance"
							icon={RELEVANCE_ICONS[verdict.relevance as Relevance]}
							tone={RELEVANCE_TONES[verdict.relevance as Relevance]}
							judged={relevanceLabel(verdict.relevance)}
							reason={verdict.relevanceReason}
						/>
						<Signal
							term="Status"
							judged={statusLabel(verdict.status)}
							reason={verdict.statusReason}
						/>
						<Signal
							term="Effort"
							judged={<EffortBadge effort={verdict.effort} />}
							reason={verdict.effortReason}
						/>
					</dl>

					{verdict.possibleDuplicateOf.length > 0 ? (
						<div className="panel-duplicates-note">
							{/*
							 * Proposed from a list of titles, so it is somewhere to look rather than a
							 * finding — and useless without the numbers, since the action that acts on it
							 * needs somewhere to send the reporter.
							 */}
							<h3>Possibly a duplicate of</h3>
							<ul className="panel-duplicates">
								{verdict.possibleDuplicateOf.map((number) => {
									const url = `${issuesUrl(item.url)}/${String(number)}`;
									return (
										<li key={number}>
											<a href={url} onClick={link(url, onOpenOnGitHub)}>
												#{number}
											</a>
										</li>
									);
								})}
							</ul>
							<p className="settings-note">
								Worth a look before closing anything: the agent matched titles, not reports.
							</p>
						</div>
					) : null}

					{verdict.evidence.length > 0 ? (
						<Disclosure label={`What ${who(assessment)} checked`} count={verdict.evidence.length}>
							<ul className="panel-evidence">
								{verdict.evidence.map((entry) => (
									<li key={entry.note}>
										<CheckIcon size={13} weight="bold" aria-hidden />
										{entry.url ? (
											<a href={entry.url} onClick={link(entry.url, onOpenOnGitHub)}>
												{entry.note}
											</a>
										) : (
											<span>{entry.note}</span>
										)}
									</li>
								))}
							</ul>
						</Disclosure>
					) : null}
				</section>
			) : null}

			{detail.analysis || detail.reviewDraft ? (
				<section className="panel-section">
					<h3>Write-ups</h3>
					{detail.analysis ? (
						<AnalysisSection
							analysis={detail.analysis}
							item={reading}
							onCopy={onCopy}
							onOpenLink={onOpenOnGitHub}
						/>
					) : null}
					{detail.reviewDraft ? (
						<ReviewDraftSection
							draft={detail.reviewDraft}
							item={reading}
							onCopy={onCopy}
							onOpenLink={onOpenOnGitHub}
							onPost={onPostReview}
						/>
					) : null}
				</section>
			) : null}

			<NoteSection
				key={`${item.kind}-${String(item.number)}`}
				text={detail.note?.text ?? ""}
				onSave={onSetNote}
			/>

			{/* The record: true, seldom needed, and so folded away until it is asked for. */}
			<section className="panel-section">
				<Disclosure label="More facts">
					<Tooltip
						content={absoluteDate(item.fetchedAt)}
						render={<p className="panel-section-note" />}
					>
						As of {refreshedAt(item.fetchedAt)}. GitHub may have moved on since.
					</Tooltip>
					<dl className="panel-facts">
						<dt>Area</dt>
						<dd>{verdict ? areaLabel(verdict.area) : "—"}</dd>
						<dt>Last activity</dt>
						<Tooltip content={absoluteDate(item.lastActivityAt)} render={<dd />}>
							{shortDuration(item.lastActivityAt, now)} ago
							{item.lastActivityBy ? ` by ${item.lastActivityBy}` : ""}
						</Tooltip>
						{isPullRequest(item) ? (
							<>
								<dt>Base</dt>
								<dd>{item.baseRef}</dd>
								<dt>Mergeable</dt>
								<dd>{item.mergeable === "CONFLICTING" ? "Conflicts" : "Yes"}</dd>
							</>
						) : null}
						{item.labels.length > 0 ? (
							<>
								<dt>Labels</dt>
								<dd>{item.labels.join(", ")}</dd>
							</>
						) : null}
					</dl>
				</Disclosure>

				{detail.history.length > 0 ? (
					<Disclosure label="Assessment history" count={detail.history.length}>
						<div className="panel-history">
							{detail.history.map((entry, index) => (
								<HistoryEntry key={entry.id} entry={entry} previous={detail.history[index + 1]} />
							))}
						</div>
					</Disclosure>
				) : null}
			</section>
		</aside>
	);
}

/**
 * One judged field as a tile: what was judged, what the agent decided, and why, in that order of
 * weight. Side by side they are four things to compare; stacked as sentences they were one
 * paragraph to read.
 */
function Signal({
	term,
	icon: Symbol,
	tone,
	judged,
	reason,
}: {
	term: string;
	/** The glyph the table's column draws for this value, so the two read as the same thing. */
	/** Absent for a value the table has no glyph for, as one stored by an older vocabulary. */
	icon?: Icon | undefined;
	tone?: GlyphTone | undefined;
	judged: React.ReactNode;
	reason: string;
}): React.JSX.Element {
	return (
		<div className="panel-signal">
			<dt>{term}</dt>
			<dd className="panel-signal-judged">
				{Symbol ? (
					<span className="panel-signal-icon toned" data-tone={tone}>
						<Symbol size={14} weight="bold" aria-hidden />
					</span>
				) : null}
				{judged}
			</dd>
			<dd className="panel-signal-reason">{reason}</dd>
		</div>
	);
}

const CHECKS_MARKS: Record<string, { icon: Icon; tone: GlyphTone | undefined }> = {
	passing: { icon: CheckCircleIcon, tone: "success" },
	failing: { icon: XCircleIcon, tone: "danger" },
	pending: { icon: ClockIcon, tone: "warn" },
};

/** The checks as the header says them: a mark whose colour is the news, then the count. */
function Checks({
	checks,
}: {
	checks: { state: string; passed: number; failed: number; pending: number };
}): React.JSX.Element {
	const mark = CHECKS_MARKS[checks.state];
	const Symbol = mark?.icon;
	return (
		<span className="panel-fact">
			{Symbol ? (
				<span className="panel-signal-icon toned" data-tone={mark?.tone}>
					<Symbol size={13} weight="bold" aria-hidden />
				</span>
			) : null}
			<span>
				<span className="visually-hidden">Checks: </span>
				{checksLabel(checks)}
			</span>
		</span>
	);
}

/**
 * A part of the panel that is there when wanted and one line when not. The browser's own
 * disclosure, so it opens with the keyboard and is found by a search of the page.
 */
function Disclosure({
	label,
	count,
	children,
}: {
	label: string;
	/** How many things are inside, when knowing that says whether it is worth opening. */
	count?: number;
	children: React.ReactNode;
}): React.JSX.Element {
	return (
		<details className="panel-disclosure">
			<summary>
				<CaretRightIcon size={12} weight="bold" aria-hidden />
				<span>{label}</span>
				{count === undefined ? null : <span className="panel-disclosure-count">{count}</span>}
			</summary>
			<div className="panel-disclosure-body">{children}</div>
		</details>
	);
}

/**
 * The note takes no room until there is one: an empty box between the agent's work and the facts
 * was a hole in the panel. Asked for, it opens with the caret in it; left empty, it folds again.
 */
function NoteSection({
	text,
	onSave,
}: {
	text: string;
	onSave: (text: string) => void;
}): React.JSX.Element {
	const [asked, setAsked] = useState(false);

	if (!asked && text === "") {
		return (
			<section className="panel-section">
				<button type="button" className="panel-add-note" onClick={() => setAsked(true)}>
					<NotePencilIcon size={14} aria-hidden />
					Add a private note
				</button>
			</section>
		);
	}
	return (
		<section className="panel-section">
			<h3>Private note</h3>
			<NoteEditor
				text={text}
				onSave={onSave}
				focused={asked}
				onLeave={(draft) => {
					if (draft === "") {
						setAsked(false);
					}
				}}
			/>
		</section>
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

/** Links inside the panel go to the browser, not to a navigation inside the app window. */
/** The repository's issue list, from any one issue's URL, so a number can be turned into a link. */
function issuesUrl(url: string): string {
	return url.slice(0, url.lastIndexOf("/"));
}

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

/** " (bot)", " (member)", and so on: what kind of author this is, or nothing when GitHub has no idea. */
function authorQualifier(item: StoredItem): string {
	const qualifier = item.isBot ? "bot" : associationLabel(item.authorAssociation);
	return qualifier ? ` (${qualifier})` : "";
}
