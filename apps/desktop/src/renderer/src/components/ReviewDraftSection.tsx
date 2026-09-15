import { Badge, Button } from "@cloudflare/kumo";
import { useState } from "react";
import { REVIEW_VERDICTS } from "@proctologist/core/browser";
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
	/** Posts the draft on GitHub; rejects with what went wrong. */
	onPost: () => Promise<void>;
}

/**
 * The review as the agent wrote it, rendered from its Markdown, under the verdict and the one-line
 * summary it gave of its own work. What is copied is the body alone: the verdict is picked in
 * GitHub's review box, and the summary was written for this panel rather than for the review.
 * Posting goes through a confirmation every time, and once done the button gives way to a mark
 * beside the verdict, with the date on hover: the header row has no room for a date of its own.
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

			<div className="panel-row">
				<Badge variant={draft.verdict === "approve" ? "green" : "orange"}>
					{REVIEW_VERDICTS[draft.verdict as keyof typeof REVIEW_VERDICTS] ?? draft.verdict}
				</Badge>
				<span className="header-meta">{absoluteDate(draft.createdAt)}</span>
				{draft.postedAt === null ? null : (
					<Tooltip content={`Posted ${absoluteDate(draft.postedAt)}`} render={<span />}>
						<Badge variant="green">Posted</Badge>
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
