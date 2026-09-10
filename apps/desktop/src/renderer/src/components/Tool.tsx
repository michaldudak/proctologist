import type { Icon } from "@phosphor-icons/react";
import { Tooltip } from "./Tooltip.js";

export interface ToolProps {
	icon: Icon;
	label: string;
	/** Why the button is dead, when it is. */
	note?: string | undefined;
	disabled: boolean;
	onClick: () => void;
}

/** What a tool's tooltip says: the command, and why it cannot be run when it cannot. */
export function toolTip({ label, note }: Pick<ToolProps, "label" | "note">): string {
	return note === undefined ? label : `${label} — ${note}`;
}

/**
 * A command with an icon for a name. The tooltip hangs off a wrapper rather than off the button,
 * because a disabled button takes no pointer events and saying why it is disabled is most of what
 * these tooltips are for.
 */
export function Tool({
	icon: Symbol,
	label,
	note,
	disabled,
	onClick,
}: ToolProps): React.JSX.Element {
	return (
		<Tooltip content={toolTip({ label, note })} render={<span />}>
			<button
				type="button"
				className="tool-button"
				aria-label={label}
				disabled={disabled}
				onClick={onClick}
			>
				<Symbol size={15} weight="regular" aria-hidden />
			</button>
		</Tooltip>
	);
}
