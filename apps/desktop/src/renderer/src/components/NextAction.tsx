import {
	ArrowUUpRightIcon,
	BellRingingIcon,
	ChatCircleIcon,
	CopySimpleIcon,
	EyeIcon,
	FlaskIcon,
	GitMergeIcon,
	HourglassIcon,
	ProhibitIcon,
	QuestionIcon,
	ScalesIcon,
	WrenchIcon,
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
	// Issues: Fix and Answer are the two a maintainer acts on straight away, as Merge and Review are.
	fix: WrenchIcon,
	// Not the plain Close icon: the maintainer is filing it against another issue, not judging it.
	close_duplicate: CopySimpleIcon,
	answer: ChatCircleIcon,
	reproduce: FlaskIcon,
	request_info: QuestionIcon,
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
