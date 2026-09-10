interface SettingRowProps {
	label: string;
	description?: string;
	disabled?: boolean;
	/** The control, which carries its own accessible label since this one is not wired to it. */
	children: React.ReactNode;
}

/**
 * One setting laid out the way system preferences do it: what it is on the left, the control on
 * the right. Keeps a small number or a switch from being stretched to the width of its sentence.
 */
export function SettingRow({
	label,
	description,
	disabled,
	children,
}: SettingRowProps): React.JSX.Element {
	return (
		<div className="setting-row" data-disabled={disabled ? "" : undefined}>
			<div className="setting-row-text">
				<span className="setting-row-label">{label}</span>
				{description === undefined ? null : (
					<span className="setting-row-description">{description}</span>
				)}
			</div>
			<div className="setting-row-control">{children}</div>
		</div>
	);
}
