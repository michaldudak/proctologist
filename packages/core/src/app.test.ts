import { describe, expect, it } from "vitest";
import { confirmThreshold } from "./app.js";

describe("confirmThreshold", () => {
	const config = { confirmAssessmentsAbove: 5, confirmTriageAbove: 1 };

	it("gives each kind the threshold that was configured for it", () => {
		expect(confirmThreshold(config, "pull_request")).toBe(5);
		expect(confirmThreshold(config, "issue")).toBe(1);
	});

	it("does not fall back to the pull request's number for an issue", () => {
		// Triage read confirmAssessmentsAbove for both, so a triage threshold of 1 with a pull
		// request threshold of 0 started a batch of two issues without asking.
		expect(confirmThreshold({ confirmAssessmentsAbove: 0, confirmTriageAbove: 1 }, "issue")).toBe(
			1,
		);
	});
});
