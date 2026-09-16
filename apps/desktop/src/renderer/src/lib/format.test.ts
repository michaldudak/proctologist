import { afterEach, describe, expect, it } from "vitest";
import {
	checksLabel,
	effortLabel,
	facetLabel,
	flagLabel,
	formatCount,
	nextActionLabel,
	refreshedAt,
	reviewDecisionLabel,
	shortDuration,
	valueLabel,
	verdictFieldLabel,
	votesLabel,
} from "./format.js";
import { resetFormattingLocale, setFormattingLocale } from "./locale.js";

describe("labels", () => {
	it("names the facets and flags the way the chips read", () => {
		expect(facetLabel("nextAction")).toBe("Next action");
		expect(flagLabel("quickWin")).toBe("Quick wins");
	});

	it("turns stored values into readable words", () => {
		expect(valueLabel("nextAction", "nudge_author")).toBe("Nudge author");
		expect(valueLabel("area", "dependency_infra")).toBe("Dependency or infrastructure");
		expect(valueLabel("status", "waiting_on_maintainer")).toBe("Waiting on maintainer");
		expect(nextActionLabel("merge")).toBe("Merge");
		expect(effortLabel("XL")).toBe("XL");
		expect(valueLabel("priority", "critical")).toBe("Critical");
	});

	it("names the verdict fields in words", () => {
		expect(verdictFieldLabel("nextAction")).toBe("next action");
		expect(verdictFieldLabel("somethingElse")).toBe("somethingElse");
	});

	it("keeps a value it does not recognise rather than showing a blank", () => {
		expect(valueLabel("area", "something_new")).toBe("something_new");
	});
});

describe("formatCount", () => {
	afterEach(resetFormattingLocale);

	it("groups thousands the way the user's region writes them", () => {
		setFormattingLocale("en-US");
		expect(formatCount(1286)).toBe("1,286");
		setFormattingLocale("de-DE");
		expect(formatCount(1286)).toBe("1.286");
	});

	it("leaves small counts alone", () => {
		setFormattingLocale("en-US");
		expect(formatCount(0)).toBe("0");
		expect(formatCount(42)).toBe("42");
	});
});

describe("shortDuration", () => {
	const now = Date.parse("2026-09-10T12:00:00.000Z");

	function ago(ms: number): string {
		return new Date(now - ms).toISOString();
	}

	it.each([
		[0, "<1m"],
		[59_000, "<1m"],
		[60_000, "1m"],
		[59 * 60_000 + 59_000, "59m"],
		[3_600_000, "1h"],
		[23 * 3_600_000 + 59 * 60_000, "23h"],
		[86_400_000, "1d"],
		[13 * 86_400_000, "13d"],
		[14 * 86_400_000, "2w"],
		[59 * 86_400_000, "8w"],
		[60 * 86_400_000, "2mo"],
		[364 * 86_400_000, "12mo"],
		[400 * 86_400_000, "1.1y"],
		[4000 * 86_400_000, "11y"],
	])("reads %i ms ago as %s", (ms, expected) => {
		expect(shortDuration(ago(ms), now)).toBe(expected);
	});

	it("never counts backwards for a timestamp ahead of the clock", () => {
		expect(shortDuration(ago(-5 * 60_000), now)).toBe("<1m");
	});
});

describe("refreshedAt", () => {
	const now = new Date(2026, 8, 10, 9, 30);

	it("names the day for today and yesterday, and keeps the time", () => {
		expect(refreshedAt(new Date(2026, 8, 10, 8, 5).toISOString(), now)).toMatch(/^Today at /);
		expect(refreshedAt(new Date(2026, 8, 9, 23, 55).toISOString(), now)).toMatch(/^Yesterday at /);
	});

	it("counts calendar days, not hours", () => {
		// Fifteen minutes earlier, but the day before: the user calls that yesterday.
		expect(refreshedAt(new Date(2026, 8, 9, 23, 45).toISOString(), now)).toMatch(/^Yesterday at /);
	});

	it("falls back to the full date beyond yesterday", () => {
		const older = refreshedAt(new Date(2026, 8, 8, 9, 30).toISOString(), now);
		expect(older).not.toMatch(/Today|Yesterday/);
		expect(older).toContain("2026");
	});
});

describe("checksLabel", () => {
	it.each([
		[{ state: "passing", passed: 12, failed: 0, pending: 0 }, "12 passing"],
		[{ state: "failing", passed: 8, failed: 2, pending: 0 }, "2 failing"],
		[{ state: "pending", passed: 1, failed: 0, pending: 3 }, "3 running"],
		[{ state: "none", passed: 0, failed: 0, pending: 0 }, "no checks"],
	])("describes %o", (checks, expected) => {
		expect(checksLabel(checks)).toBe(expected);
	});
});

describe("reviewDecisionLabel", () => {
	it("reads GitHub's decisions", () => {
		expect(reviewDecisionLabel("CHANGES_REQUESTED")).toBe("Changes requested");
		expect(reviewDecisionLabel(null)).toBeNull();
		expect(reviewDecisionLabel("SOMETHING_ELSE")).toBeNull();
	});
});

describe("votesLabel", () => {
	it("signs the votes, and keeps a contested issue legible as a pair", () => {
		expect(votesLabel(4, 2)).toBe("+4 / -2");
		expect(votesLabel(4, 0)).toBe("+4");
		expect(votesLabel(0, 2)).toBe("-2");
	});

	it("says nought rather than nothing, so no votes does not read as no data", () => {
		expect(votesLabel(0, 0)).toBe("0");
	});
});
