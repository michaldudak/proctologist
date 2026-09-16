import type { Snooze } from "@proctologist/core/browser";
import type { SnoozeEnd } from "../../../shared/ipc.js";
import { absoluteDate } from "./format.js";

/** The choices both snooze menus offer, in the order they are listed. */
export const SNOOZE_OPTIONS = ["change", "week", "month", "forever"] as const;

export type SnoozeOption = (typeof SNOOZE_OPTIONS)[number];

const DAYS: Record<Extract<SnoozeOption, "week" | "month">, number> = { week: 7, month: 30 };

/** How a menu item reads; the first one names its subject, which the selection bar has several of. */
export function snoozeOptionLabel(option: SnoozeOption, subject: "it" | "them"): string {
	switch (option) {
		case "change": {
			return subject === "it" ? "Until it changes" : "Until they change";
		}
		case "week": {
			return "For a week";
		}
		case "month": {
			return "For a month";
		}
		default: {
			return "Indefinitely";
		}
	}
}

/** What the option asks for, with the dated ones counted from `now`. */
export function snoozeEnd(option: SnoozeOption, now = Date.now()): SnoozeEnd {
	switch (option) {
		case "change": {
			return { when: "assessment_replaced" };
		}
		case "forever": {
			return { when: "never" };
		}
		default: {
			return { when: "date", date: new Date(now + DAYS[option] * 86_400_000).toISOString() };
		}
	}
}

/** What a standing snooze is waiting for, for the tooltip of the button that lifts it. */
export function describeSnooze(snooze: Snooze): string {
	if (snooze.untilDate !== null) {
		return `Until ${absoluteDate(snooze.untilDate)}`;
	}
	if (snooze.untilAssessmentId !== null) {
		return "Until it changes";
	}
	return "Indefinitely";
}
