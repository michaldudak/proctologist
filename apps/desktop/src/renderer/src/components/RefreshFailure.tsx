import { Banner, Button } from "@cloudflare/kumo";
import type { Refresh } from "../../../shared/ipc.js";

/**
 * What to do about each sort of failure. "Try again" is always offered, but for a rate limit it
 * would fail the same way, and saying so is the difference between a useful message and a scary
 * one.
 */
const ADVICE: Record<string, { advice: string; retryHelps: boolean }> = {
	not_installed: {
		advice:
			"If it is installed and your terminal can find it, the app was started before your shell knew about it; quitting and reopening will pick it up.",
		retryHelps: false,
	},
	not_authenticated: {
		advice: "Once you have signed in, Try again picks it up. The app does not need restarting.",
		retryHelps: true,
	},
	rate_limited: {
		advice:
			"GitHub's limit resets on its own, usually within the hour. Trying again before then will fail the same way.",
		retryHelps: false,
	},
	not_found: {
		advice:
			"Check the repository name in Settings, and that the account `gh` is signed in as can see it.",
		retryHelps: false,
	},
	invalid_output: {
		advice: "GitHub returned something unexpected. Trying again usually clears it.",
		retryHelps: true,
	},
};

const FALLBACK = {
	advice:
		"Trying again is worth a go. If it keeps failing, running the same thing through `gh` in a terminal will show the error with more detail.",
	retryHelps: true,
};

interface RefreshFailureProps {
	refresh: Refresh;
	onRetry: () => void;
	onDismiss: () => void;
}

export function RefreshFailure({
	refresh,
	onRetry,
	onDismiss,
}: RefreshFailureProps): React.JSX.Element {
	const { advice, retryHelps } = ADVICE[refresh.errorKind ?? ""] ?? FALLBACK;

	return (
		<div className="refresh-failure">
			<Banner
				variant="error"
				title={`Couldn't refresh ${refresh.repository}`}
				description={
					<>
						<span>{refresh.error ?? "Something went wrong."}</span>
						<br />
						<span>{advice}</span>
					</>
				}
				action={
					<>
						<Button size="xs" variant={retryHelps ? "primary" : "secondary"} onClick={onRetry}>
							Try again
						</Button>
						<Button size="xs" variant="ghost" onClick={onDismiss}>
							Dismiss
						</Button>
					</>
				}
			/>
		</div>
	);
}
