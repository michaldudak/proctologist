import { describe, expect, it } from "vitest";
import type { Snooze } from "@proctologist/core/browser";
import { describeSnooze, snoozeEnd, snoozeOptionLabel } from "./snooze.js";

const NOW = Date.parse("2026-09-15T12:00:00.000Z");

function snooze(overrides: Partial<Snooze>): Snooze {
	return {
		repository: "owner/thing",
		kind: "pull_request",
		number: 1,
		untilAssessmentId: null,
		untilDate: null,
		createdAt: "2026-09-15T12:00:00.000Z",
		...overrides,
	};
}

describe("snoozeEnd", () => {
	it("asks for the next assessment, a date counted from now, or no end at all", () => {
		expect(snoozeEnd("change", NOW)).toEqual({ when: "assessment_replaced" });
		expect(snoozeEnd("week", NOW)).toEqual({ when: "date", date: "2026-09-22T12:00:00.000Z" });
		expect(snoozeEnd("month", NOW)).toEqual({ when: "date", date: "2026-10-15T12:00:00.000Z" });
		expect(snoozeEnd("forever", NOW)).toEqual({ when: "never" });
	});
});

describe("snoozeOptionLabel", () => {
	it("names the subject only where the option has one", () => {
		expect(snoozeOptionLabel("change", "it")).toBe("Until it changes");
		expect(snoozeOptionLabel("change", "them")).toBe("Until they change");
		expect(snoozeOptionLabel("forever", "them")).toBe("Indefinitely");
	});
});

describe("describeSnooze", () => {
	it("says what the snooze is waiting for", () => {
		expect(describeSnooze(snooze({ untilAssessmentId: 3 }))).toBe("Until it changes");
		expect(describeSnooze(snooze({ untilDate: "2026-09-22T12:00:00.000Z" }))).toMatch(/^Until /);
		expect(describeSnooze(snooze({}))).toBe("Indefinitely");
	});
});
