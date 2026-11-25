import { Badge, Button } from "@cloudflare/kumo";
import { NotePencilIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { REVIEW_VERDICTS, type ReviewVerdict } from "@proctologist/core/browser";
import type { ReviewDraft } from "../../../shared/ipc.js";
import { absoluteDate } from "../lib/format.js";
import { PostReviewDialog } from "./PostReviewDialog.js";
import { ReaderDialog } from "./ReaderDialog.js";
import { Tooltip } from "./Tooltip.js";

interface ReviewDraftSectionProps {
	draft: ReviewDraft;
	/** The pull request the draft is about, with its head as last fetched, to say when the draft describes an older one. */
	item: { number: number; title: string; headSha: string };
	onCopy: (text: string) => void;
	/** Links in the review open outside the app. */
	onOpenLink: (url: string) => void;
	/** Posts the draft on GitHub with the verdict chosen; rejects with what went wrong. */
	onPost: (verdict: ReviewVerdict) => Promise<void>;
}

/**
 * The review in the side panel as its verdict and the one-line summary the agent gave of its own
 * work; the review itself opens in the reader, as the analysis does, because it is pages of
 * findings and the panel is a column. What is copied is the body alone: the verdict is picked in
 * GitHub's review box, and the summary was written for this panel rather than for the review.
 * Posting goes through a confirmation every time, where the verdict can be overruled, and once
 * done the button gives way to a mark beside the verdict that says what actually went up, with
 * the date on hover.
 */
export function ReviewDraftSection({
	draft,
	item,
	onCopy,
	onOpenLink,
	onPost,
}: ReviewDraftSectionProps): React.JSX.Element {
	const [reading, setReading] = useState(false);
	const [copied, setCopied] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const label = (verdict: string): string => REVIEW_VERDICTS[verdict as ReviewVerdict] ?? verdict;
	// Overruled at posting time, the mark says so; otherwise the verdict beside it is the one posted.
	const postedAs =
		draft.postedAs !== null && draft.postedAs !== draft.verdict ? draft.postedAs : null;
	const stale = draft.headSha !== item.headSha;
	const written = `Written ${absoluteDate(draft.createdAt)}`;

	const marks = (
		<>
			<Badge variant={draft.verdict === "approve" ? "green" : "orange"}>
				{label(draft.verdict)}
			</Badge>
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
			{stale ? <Badge variant="warning">Describes an older version</Badge> : null}
		</>
	);

	return (
		<article className="write-up">
			<div className="write-up-head">
				<NotePencilIcon size={15} aria-hidden />
				<h4>Review draft</h4>
				{marks}
			</div>

			<p className="write-up-lead">{draft.summary}</p>

			<div className="write-up-foot">
				<span className="header-meta">{written}</span>
				<Button
					size="xs"
					variant="ghost"
					onClick={() => {
						onCopy(draft.body);
						setCopied(true);
					}}
				>
					{copied ? "Copied" : "Copy"}
				</Button>
				{draft.postedAt === null ? (
					<Button size="xs" variant="ghost" onClick={() => setConfirming(true)}>
						Post it
					</Button>
				) : null}
				<Button size="xs" variant="secondary" onClick={() => setReading(true)}>
					Read
				</Button>
			</div>

			{reading ? (
				<ReaderDialog
					label="Review draft"
					item={item}
					markdown={draft.body}
					meta={
						<>
							{marks}
							<span className="header-meta">{written}</span>
						</>
					}
					onCopy={onCopy}
					onOpenLink={onOpenLink}
					onClose={() => setReading(false)}
				/>
			) : null}

			{confirming ? (
				<PostReviewDialog
					repository={draft.repository}
					number={draft.number}
					verdict={draft.verdict}
					stale={stale}
					onPost={onPost}
					onClose={() => setConfirming(false)}
				/>
			) : null}
		</article>
	);
}
