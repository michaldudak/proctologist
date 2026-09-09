import { Badge } from "@cloudflare/kumo";
import type { Effort } from "@proctologist/core/browser";
import { effortLabel } from "../lib/format.js";

type BadgeVariant = "green" | "blue" | "purple" | "orange" | "red";

/**
 * Cool to warm, in the order the efforts run. Unlike the next action, effort is a scale, so the
 * colours are a ramp rather than a set: the eye should be able to sort a column by them, and the
 * ends should be the loud ones. Teal would have fitted the ramp better than purple but Kumo's teal
 * and green badges are within a few points of each other, which would have cost XS and S their
 * difference — the thing this column is most often read for.
 */
const VARIANTS: Record<Effort, BadgeVariant> = {
	XS: "green",
	S: "blue",
	M: "purple",
	L: "orange",
	XL: "red",
};

export function EffortBadge({ effort }: { effort: Effort }): React.JSX.Element {
	return <Badge variant={VARIANTS[effort]}>{effortLabel(effort)}</Badge>;
}
