import { Button, DropdownMenu } from "@cloudflare/kumo";
import { BellZIcon, XIcon } from "@phosphor-icons/react";
import type { ItemKind } from "@proctologist/core/browser";
import type { SnoozeEnd } from "../../../shared/ipc.js";
import { SNOOZE_OPTIONS, snoozeEnd, snoozeOptionLabel } from "../lib/snooze.js";
import { ToolMenu } from "./Tool.js";

export interface SelectionBarProps {
	children?: React.ReactNode;
	count: number;
	kind: ItemKind;
	onJudge: () => void;
	onSnooze: (until: SnoozeEnd) => void;
	onClear: () => void;
}

/**
 * What ticking rows is for. The primary button in the header already acts on them, but a count in
 * a button at the other end of the window is not where the eye is after ticking a row, so the bar
 * says what is picked out and what can be done with it where the picking happened.
 */
export function SelectionBar({
	children,
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
				{SNOOZE_OPTIONS.map((option) => (
					<DropdownMenu.Item key={option} onClick={() => onSnooze(snoozeEnd(option))}>
						{snoozeOptionLabel(option, "them")}
					</DropdownMenu.Item>
				))}
			</ToolMenu>
			{children}
			<span className="header-spacer" />
			<Button size="xs" variant="secondary" onClick={onClear}>
				<XIcon size={12} aria-hidden />
				Clear
			</Button>
		</div>
	);
}
