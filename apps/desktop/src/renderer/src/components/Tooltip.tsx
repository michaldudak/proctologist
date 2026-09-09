import { Tooltip as KumoTooltip } from "@cloudflare/kumo";
import type { ComponentProps } from "react";

/**
 * Kumo waits 600ms before it shows a tooltip. The table is read by sweeping the pointer along a
 * row of icons, and at 600ms that sweep outruns the answer, so everything here opens sooner.
 */
export const TOOLTIP_DELAY = 350;

export type TooltipProps = ComponentProps<typeof KumoTooltip>;

/** Kumo's tooltip with our delay. Use it everywhere rather than reaching for Kumo's directly. */
export function Tooltip(props: TooltipProps): React.JSX.Element {
	return <KumoTooltip delay={TOOLTIP_DELAY} {...props} />;
}
