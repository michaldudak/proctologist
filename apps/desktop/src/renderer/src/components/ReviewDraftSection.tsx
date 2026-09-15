import { Badge, Button } from "@cloudflare/kumo";
import { useState } from "react";
import { REVIEW_VERDICTS, type ReviewVerdict } from "@proctologist/core/browser";
import type { ReviewDraft } from "../../../shared/ipc.js";
import { absoluteDate } from "../lib/format.js";
import { Markdown } from "./Markdown.js";
import { PostReviewDialog } from "./PostReviewDialog.js";
import { Tooltip } from "./Tooltip.js";

interface ReviewDraftSectionProps {
	draft: ReviewDraft;
	/** The pull request's head as last fetched, to say when the draft describes an older one. */
	currentHeadSha: string;
	onCopy: (text: string) => void;
	/** Links in the review open outside the app. */
	onOpenLink: (url: string) => void;
	/** Posts the draft on GitHub with the verdict chosen; rejects with what went wrong. */
	onPost: (verdict: ReviewVerdict) => Promise<void>;
}

/**
 * The review as the agent wrote it, rendered from its Markdown, under the verdict and the one-line
 * summary it gave of its own work. What is copied is the body alone: the verdict is picked in
 * GitHub's review box, and the summary was written for this panel rather than for the review.
 * Posting goes through a confirmation every time, where the verdict can be overruled, and once
 * done the button gives way to a mark beside the verdict that says what actually went up, with
 * the date on hover: the header row has no room for a date of its own.
 */
export function ReviewDraftSection({
	draft,
	currentHeadSha,
	onCopy,
	onOpenLink,
	onPost,
}: ReviewDraftSectionProps): React.JSX.Element {
	const [copied, setCopied] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const label = (verdict: string): string => REVIEW_VERDICTS[verdict as ReviewVerdict] ?? verdict;
	// Overruled at posting time, the mark says so; otherwise the verdict beside it is the one posted.
	const postedAs =
		draft.postedAs !== null && draft.postedAs !== draft.verdict ? draft.postedAs : null;

	return (
		<section className="panel-section">
			<div className="panel-row">
				<h3>Review draft</h3>
				<span className="header-spacer" />
				<Button
					size="xs"
					variant="ghost"
					onClick={() => {
						onCopy(draft.body);
						setCopied(true);
					}}
				>
					{copied ? "Copied" : "Copy as markdown"}
				</Button>
				{draft.postedAt === null ? (
					<Button size="xs" variant="ghost" onClick={() => setConfirming(true)}>
						Post it
					</Button>
				) : null}
			</div>

			<div className="panel-row review-draft-meta">
				<Badge variant={draft.verdict === "approve" ? "green" : "orange"}>
					{label(draft.verdict)}
				</Badge>
				<span className="header-meta">{absoluteDate(draft.createdAt)}</span>
				{draft.postedAt === null ? null : (
					<Tooltip
						content={`Posted ${absoluteDate(draft.postedAt)} as ${label(draft.postedAs ?? draft.verdict)}`}
						render={<span />}
					>
						<Badge variant="green">
							{postedAs === null ? "Posted" : `Posted as ${label(postedAs)}`}
						</Badge>
					</Tooltip>
				)}
			</div>

			<p>{draft.summary}</p>

			<div className="review-draft-body prose">
				<Markdown markdown={draft.body} onOpenLink={onOpenLink} />
			</div>

			{confirming ? (
				<PostReviewDialog
					repository={draft.repository}
					number={draft.number}
					verdict={draft.verdict}
					stale={draft.headSha !== currentHeadSha}
					onPost={onPost}
					onClose={() => setConfirming(false)}
				/>
			) : null}
		</section>
	);
}
