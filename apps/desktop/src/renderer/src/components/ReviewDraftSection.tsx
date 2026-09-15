import { Badge, Button } from "@cloudflare/kumo";
import { useState } from "react";
import { REVIEW_VERDICTS } from "@proctologist/core/browser";
import type { ReviewDraft } from "../../../shared/ipc.js";
import { absoluteDate } from "../lib/format.js";
import { Markdown } from "./Markdown.js";

interface ReviewDraftSectionProps {
	draft: ReviewDraft;
	onCopy: (text: string) => void;
	/** Links in the review open outside the app, as does the pull request itself. */
	onOpenLink: (url: string) => void;
	itemUrl: string;
}

/**
 * The review as the agent wrote it, rendered from its Markdown, under the verdict and the one-line
 * summary it gave of its own work. What is copied is the body alone: the verdict is picked in
 * GitHub's review box, and the summary was written for this panel rather than for the review.
 */
export function ReviewDraftSection({
	draft,
	onCopy,
	onOpenLink,
	itemUrl,
}: ReviewDraftSectionProps): React.JSX.Element {
	const [copied, setCopied] = useState(false);

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
				<Button size="xs" variant="ghost" onClick={() => onOpenLink(itemUrl)}>
					Post it yourself
				</Button>
			</div>

			<div className="panel-row">
				<Badge variant={draft.verdict === "approve" ? "green" : "orange"}>
					{REVIEW_VERDICTS[draft.verdict as keyof typeof REVIEW_VERDICTS] ?? draft.verdict}
				</Badge>
				<span className="header-meta">{absoluteDate(draft.createdAt)}</span>
			</div>

			<p>{draft.summary}</p>

			<div className="review-draft-body prose">
				<Markdown markdown={draft.body} onOpenLink={onOpenLink} />
			</div>
		</section>
	);
}
