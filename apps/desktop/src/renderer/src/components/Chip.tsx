interface ChipProps {
	label: string;
	count?: number | undefined;
	pressed: boolean;
	onToggle: () => void;
}

/** A toggle that shows what selecting it would leave, which is what makes the counts worth having. */
export function Chip({ label, count, pressed, onToggle }: ChipProps): React.JSX.Element {
	const empty = count === 0 && !pressed;

	return (
		<button
			type="button"
			className="chip"
			aria-pressed={pressed}
			disabled={empty}
			onClick={onToggle}
		>
			{label}
			{count === undefined ? null : <span className="chip-count">{count}</span>}
		</button>
	);
}
