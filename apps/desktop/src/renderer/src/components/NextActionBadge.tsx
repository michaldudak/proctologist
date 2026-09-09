import { Badge } from "@cloudflare/kumo";
import type { NextAction } from "@proctologist/core/browser";
import { nextActionLabel } from "../lib/format.js";

type BadgeVariant = "green" | "blue" | "purple" | "orange" | "red" | "teal" | "neutral";

/** Colour carries the next action, which is the first thing the eye should land on. */
const VARIANTS: Record<NextAction, BadgeVariant> = {
	merge: "green",
	review: "blue",
	continue: "purple",
	nudge_author: "orange",
	close: "red",
	decide: "teal",
	wait: "neutral",
};

export function NextActionBadge({ action }: { action: NextAction }): React.JSX.Element {
	return <Badge variant={VARIANTS[action]}>{nextActionLabel(action)}</Badge>;
}
