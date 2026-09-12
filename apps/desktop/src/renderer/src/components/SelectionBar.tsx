import { Button, DropdownMenu } from "@cloudflare/kumo";
import { BellZIcon, XIcon } from "@phosphor-icons/react";
import type { ItemKind } from "@proctologist/core/browser";
import { ToolMenu } from "./Tool.js";

export interface SelectionBarProps {
	count: number;
	kind: ItemKind;
	onJudge: () => void;
	onSnooze: (until?: string) => void;
	onClear: () => void;
}

const SNOOZE_OPTIONS = {
	change: "Until they change",
	week: "For a week",
	month: "For a month",
} as const;

/**
 * What ticking rows is for. The primary button in the header already acts on them, but a count in
 * a button at the other end of the window is not where the eye is after ticking a row, so the bar
 * says what is picked out and what can be done with it where the picking happened.
 */
export function SelectionBar({
	count,
	kind,
	onJudge,
	onSnooze,
	onClear,
}: SelectionBarProps): React.JSX.Element {
	const verb = kind === "issue" ? "Triage" : "Assess";
	return (
		<div className="selection-bar" role="status">
			<span className="selection-count">
				{count} {kind === "issue" ? "issue" : "pull request"}
				{count === 1 ? "" : "s"} picked
			</span>
			<Button size="xs" variant="primary" onClick={onJudge}>
				{`${verb} ${String(count)}`}
			</Button>
			<ToolMenu icon={BellZIcon} label="Snooze them" emphasis="plain" disabled={false}>
				{Object.entries(SNOOZE_OPTIONS).map(([option, label]) => (
					<DropdownMenu.Item key={option} onClick={() => onSnooze(until(option))}>
						{label}
					</DropdownMenu.Item>
				))}
			</ToolMenu>
			<span className="header-spacer" />
			<Button size="xs" variant="secondary" onClick={onClear}>
				<XIcon size={12} aria-hidden />
				Clear
			</Button>
		</div>
	);
}

/** A date for the dated options; nothing means "until the assessment is replaced". */
function until(option: string): string | undefined {
	if (option === "change") {
		return undefined;
	}
	const days = option === "week" ? 7 : 30;
	return new Date(Date.now() + days * 86_400_000).toISOString();
}
