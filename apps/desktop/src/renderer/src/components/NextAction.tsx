import {
	ArrowUUpRightIcon,
	BellRingingIcon,
	EyeIcon,
	GitMergeIcon,
	HourglassIcon,
	ProhibitIcon,
	ScalesIcon,
	type Icon,
} from "@phosphor-icons/react";
import type { NextAction as NextActionValue } from "@proctologist/core/browser";
import { nextActionLabel } from "../lib/format.js";

/**
 * The action stays in words — it is the column the table is read for — so the icon only has to give
 * the eye a shape to jump between rows by, which is what colour used to do before every other
 * column started competing for it.
 */
export const NEXT_ACTION_ICONS: Record<NextActionValue, Icon> = {
	merge: GitMergeIcon,
	review: EyeIcon,
	continue: ArrowUUpRightIcon,
	nudge_author: BellRingingIcon,
	close: ProhibitIcon,
	decide: ScalesIcon,
	wait: HourglassIcon,
};

export function NextAction({ action }: { action: NextActionValue }): React.JSX.Element {
	const Symbol = NEXT_ACTION_ICONS[action];

	return (
		<span className="next-action">
			<Symbol size={14} weight="bold" aria-hidden />
			{nextActionLabel(action)}
		</span>
	);
}
