import { Badge } from "@cloudflare/kumo";
import type { Effort } from "@proctologist/core/browser";
import { effortLabel } from "../lib/format.js";

/**
 * Cool to warm, in the order the efforts run. Unlike the next action, effort is a scale, so the
 * colours are a ramp rather than a set: the eye should be able to sort a column by them, and the
 * ends should be the loud ones. Teal would have fitted the ramp better than purple but Kumo's teal
 * and green badges are within a few points of each other, which would have cost XS and S their
 * difference — the thing this column is most often read for.
 *
 * The hue is applied by the stylesheet as a wash rather than Kumo's solid fill, which is louder
 * than a qualifier in a table cell should be.
 */
const HUE_CLASSES: Record<Effort, string> = {
	XS: "effort-badge-xs",
	S: "effort-badge-s",
	M: "effort-badge-m",
	L: "effort-badge-l",
	XL: "effort-badge-xl",
};

export function EffortBadge({ effort }: { effort: Effort }): React.JSX.Element {
	return (
		<Badge variant="secondary" className={`effort-badge ${HUE_CLASSES[effort]}`}>
			{effortLabel(effort)}
		</Badge>
	);
}
