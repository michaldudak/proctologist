import { GitPullRequestIcon, WarningCircleIcon } from "@phosphor-icons/react";
import type { ItemKind } from "@proctologist/core/browser";
import { Tooltip } from "./Tooltip.js";

export interface RailProps {
	kind: ItemKind;
	onSelect: (kind: ItemKind) => void;
	/**
	 * Due counts for the current scope. The rail shows only whether there is anything, not how
	 * much, but the number is what a screen reader is told.
	 */
	due: { pull_request: number; issue: number };
	/** Hidden when no tracked repository has its issues turned on. */
	showIssues: boolean;
}

const DESTINATIONS = [
	{
		kind: "pull_request" as const,
		label: "Pull requests",
		shortcut: "⌘1",
		Icon: GitPullRequestIcon,
	},
	{ kind: "issue" as const, label: "Issues", shortcut: "⌘2", Icon: WarningCircleIcon },
];

/**
 * The app's destinations. The kind is the destination and the repository is a scope, which is what
 * lets a destination that belongs to no repository join the rail later; a switcher with tabs under
 * it could never have held one.
 *
 * Icon-only, and the mark beside each icon is a dot rather than a count: at this size a number
 * sits on top of the icon it is meant to annotate, and the rail only has to answer "is there
 * anything over there", which a dot answers without obscuring the answer to "what is over there".
 * The count itself is still in the accessible name.
 */
export function Rail({ kind, onSelect, due, showIssues }: RailProps): React.JSX.Element {
	const shown = showIssues ? DESTINATIONS : DESTINATIONS.slice(0, 1);
	return (
		<nav className="rail" aria-label="Destinations">
			{shown.map((destination) => {
				const count = due[destination.kind];
				return (
					<Tooltip
						key={destination.kind}
						content={
							count > 0
								? `${destination.label} — ${String(count)} due (${destination.shortcut})`
								: `${destination.label} (${destination.shortcut})`
						}
						render={
							<button
								type="button"
								className="rail-button"
								aria-current={kind === destination.kind}
								aria-label={
									count > 0 ? `${destination.label}, ${String(count)} due` : destination.label
								}
								onClick={() => {
									onSelect(destination.kind);
								}}
							/>
						}
					>
						<destination.Icon size={18} weight={kind === destination.kind ? "fill" : "regular"} />
						{count > 0 ? <span className="rail-dot" aria-hidden /> : null}
					</Tooltip>
				);
			})}
		</nav>
	);
}
