import { Button, Dialog, Select } from "@cloudflare/kumo";
import { useState } from "react";
import { REVIEW_VERDICTS, type ReviewVerdict } from "@proctologist/core/browser";

interface PostReviewDialogProps {
	repository: string;
	number: number;
	/** The agent's verdict, which the picker starts on. */
	verdict: string;
	/** True when the pull request has moved on since the draft was written. */
	stale: boolean;
	onPost: (verdict: ReviewVerdict) => Promise<void>;
	onClose: () => void;
}

/**
 * The one thing the app writes to GitHub, asked about every time: the review goes up under the
 * user's own account, with the verdict picked here — the agent's unless the user overrules it —
 * and cannot be taken back from here. A failure stays in the dialog rather than going to the
 * console, so a rejected post is never mistaken for a posted one.
 */
export function PostReviewDialog({
	repository,
	number,
	verdict,
	stale,
	onPost,
	onClose,
}: PostReviewDialogProps): React.JSX.Element {
	const [chosen, setChosen] = useState<ReviewVerdict>(isVerdict(verdict) ? verdict : "comment");
	const [posting, setPosting] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const agentLabel = REVIEW_VERDICTS[verdict as ReviewVerdict] ?? verdict;

	const post = async (): Promise<void> => {
		setPosting(true);
		setError(undefined);
		try {
			await onPost(chosen);
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
					It goes up under your own GitHub account with the draft as its text. It cannot be taken
					back from here; edit it on GitHub afterwards if you must.
				</Dialog.Description>

				<Select
					label="Post as"
					description={
						chosen === verdict ? undefined : `The agent said ${agentLabel}; the text still does.`
					}
					value={chosen}
					disabled={posting}
					onValueChange={(next) => next !== null && isVerdict(next) && setChosen(next)}
					items={REVIEW_VERDICTS}
				/>

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
						{posting ? "Posting…" : `Post as ${REVIEW_VERDICTS[chosen]}`}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}

function isVerdict(value: string): value is ReviewVerdict {
	return Object.hasOwn(REVIEW_VERDICTS, value);
}

/** Electron wraps an error thrown across IPC in its own words; the user wants the original ones. */
function messageOf(cause: unknown): string {
	const message = cause instanceof Error ? cause.message : String(cause);
	return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
