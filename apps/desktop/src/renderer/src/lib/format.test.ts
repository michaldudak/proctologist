import { describe, expect, it } from "vitest";
import {
	checksLabel,
	effortLabel,
	facetLabel,
	flagLabel,
	nextActionLabel,
	reviewDecisionLabel,
	shortDuration,
	valueLabel,
} from "./format.js";

describe("labels", () => {
	it("names the facets and flags the way the chips read", () => {
		expect(facetLabel("nextAction")).toBe("Next action");
		expect(flagLabel("quickWin")).toBe("Quick wins");
	});

	it("turns stored values into readable words", () => {
		expect(valueLabel("nextAction", "nudge_author")).toBe("Nudge author");
		expect(valueLabel("category", "dependency_infra")).toBe("Dependency or infrastructure");
		expect(valueLabel("status", "waiting_on_maintainer")).toBe("Waiting on maintainer");
		expect(nextActionLabel("merge")).toBe("Merge");
		expect(effortLabel("XL")).toBe("XL");
	});

	it("keeps a value it does not recognise rather than showing a blank", () => {
		expect(valueLabel("category", "something_new")).toBe("something_new");
	});
});

describe("shortDuration", () => {
	it.each([
		[0, "today"],
		[1, "1d"],
		[13, "13d"],
		[14, "2w"],
		[59, "8w"],
		[60, "2mo"],
		[364, "12mo"],
		[400, "1.1y"],
		[4000, "11y"],
	])("reads %i days as %s", (days, expected) => {
		expect(shortDuration(days)).toBe(expected);
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
