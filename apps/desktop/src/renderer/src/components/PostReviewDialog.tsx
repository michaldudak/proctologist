import { Button, Dialog } from "@cloudflare/kumo";
import { useState } from "react";
import { REVIEW_VERDICTS, type ReviewVerdict } from "@proctologist/core/browser";

interface PostReviewDialogProps {
	repository: string;
	number: number;
	verdict: string;
	/** True when the pull request has moved on since the draft was written. */
	stale: boolean;
	onPost: () => Promise<void>;
	onClose: () => void;
}

/**
 * The one thing the app writes to GitHub, asked about every time: the review goes up under the
 * user's own account, with the verdict the agent gave, and cannot be taken back from here. A
 * failure stays in the dialog rather than going to the console, so a rejected post is never
 * mistaken for a posted one.
 */
export function PostReviewDialog({
	repository,
	number,
	verdict,
	stale,
	onPost,
	onClose,
}: PostReviewDialogProps): React.JSX.Element {
	const [posting, setPosting] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const verdictLabel = REVIEW_VERDICTS[verdict as ReviewVerdict] ?? verdict;

	const post = async (): Promise<void> => {
		setPosting(true);
		setError(undefined);
		try {
			await onPost();
			onClose();
		} catch (cause) {
			setError(messageOf(cause));
			setPosting(false);
		}
	};

	return (
		<Dialog.Root
			open
			onOpenChange={(open) => {
				if (!open && !posting) {
					onClose();
				}
			}}
		>
			<Dialog className="post-review-dialog">
				<Dialog.Title>
					Post this review on {repository}#{String(number)}?
				</Dialog.Title>
				<Dialog.Description>
					It goes up under your own GitHub account as a review that says{" "}
					<strong>{verdictLabel}</strong>, with the draft as its text. It cannot be taken back from
					here; edit it on GitHub afterwards if you must.
				</Dialog.Description>

				{stale ? (
					<p className="dialog-warning">
						The pull request has changed since this draft was written. Read the draft against the
						current code before posting it.
					</p>
				) : null}

				{error === undefined ? null : <p className="error">{error}</p>}

				<div className="dialog-actions">
					<Button variant="ghost" disabled={posting} onClick={onClose}>
						Not now
					</Button>
					<Button variant="primary" disabled={posting} onClick={() => void post()}>
						{posting ? "Posting…" : `Post as ${verdictLabel}`}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

/** Electron wraps an error thrown across IPC in its own words; the user wants the original ones. */
function messageOf(cause: unknown): string {
	const message = cause instanceof Error ? cause.message : String(cause);
	return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
