import { DropdownMenu } from "@cloudflare/kumo";
import type { Icon } from "@phosphor-icons/react";
import { Tooltip } from "./Tooltip.js";

export interface ToolProps {
	icon: Icon;
	label: string;
	/** Why the button is dead, when it is. */
	note?: string | undefined;
	disabled: boolean;
	/**
	 * "quiet" sits the icon back to read as furniture in a row of commands; "plain" draws it like
	 * the header's other controls, for a tool standing beside them rather than in such a row.
	 */
	emphasis?: "quiet" | "plain" | undefined;
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
	emphasis = "quiet",
	onClick,
}: ToolProps): React.JSX.Element {
	return (
		<Tooltip content={toolTip({ label, note })} render={<span />}>
			<button
				type="button"
				className="tool-button"
				data-emphasis={emphasis}
				aria-label={label}
				disabled={disabled}
				onClick={onClick}
			>
				<Symbol size={15} weight={emphasis === "plain" ? "bold" : "regular"} aria-hidden />
			</button>
		</Tooltip>
	);
}

/** A tool whose click opens a menu of commands rather than running one. */
export function ToolMenu({
	icon: Symbol,
	label,
	note,
	disabled,
	emphasis = "quiet",
	align = "center",
	children,
}: Omit<ToolProps, "onClick"> & {
	align?: "start" | "center" | "end" | undefined;
	children: React.ReactNode;
}): React.JSX.Element {
	return (
		<Tooltip content={toolTip({ label, note })} render={<span />}>
			<DropdownMenu>
				<DropdownMenu.Trigger
					render={
						<button
							type="button"
							className="tool-button"
							data-emphasis={emphasis}
							aria-label={label}
							disabled={disabled}
						/>
					}
				>
					<Symbol size={15} weight={emphasis === "plain" ? "bold" : "regular"} aria-hidden />
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align={align} className="menu-content">
					{children}
				</DropdownMenu.Content>
			</DropdownMenu>
		</Tooltip>
	);
}
