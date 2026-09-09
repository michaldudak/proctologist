import { describe, expect, it } from "vitest";
import { assessmentJsonSchema, validateAssessment, type AssessmentOutput } from "./schema.js";

function output(overrides: Partial<AssessmentOutput> = {}): Record<string, unknown> {
	return {
		next_action: "review",
		next_action_reason: "Nobody has looked at it.",
		category: "bug_fix",
		relevance: "still_relevant",
		relevance_reason: "The branch it patches is still there.",
		status: "waiting_on_maintainer",
		status_reason: "No review yet.",
		effort: "S",
		effort_reason: "Two small files.",
		summary: "Fixes an off-by-one.",
		confidence: 0.7,
		evidence: [{ note: "src/thing.ts still has the loop", url: "https://example.test/1" }],
		...overrides,
	};
}

describe("validateAssessment", () => {
	it("converts a valid reply to the stored shape", () => {
		const result = validateAssessment(output());

		expect(result).toEqual({
			ok: true,
			verdict: {
				nextAction: "review",
				nextActionReason: "Nobody has looked at it.",
				category: "bug_fix",
				relevance: "still_relevant",
				relevanceReason: "The branch it patches is still there.",
				status: "waiting_on_maintainer",
				statusReason: "No review yet.",
				effort: "S",
				effortReason: "Two small files.",
				summary: "Fixes an off-by-one.",
				confidence: 0.7,
				evidence: [{ note: "src/thing.ts still has the loop", url: "https://example.test/1" }],
			},
		});
	});

	it("accepts evidence without a URL and an empty evidence list", () => {
		const result = validateAssessment(output({ evidence: [{ note: "nothing to add" }] }));

		expect(result.ok).toBe(true);
		expect(validateAssessment(output({ evidence: [] })).ok).toBe(true);
	});

	it.each([
		["next_action", "ship_it"],
		["category", "misc"],
		["relevance", "maybe"],
		["status", "unknown"],
		["effort", "XXL"],
	])("rejects an unknown %s and names the field", (field, value) => {
		const result = validateAssessment(output({ [field]: value }));

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.issues.join(" ")).toContain(field);
	});

	it("rejects a confidence outside 0 to 1", () => {
		expect(validateAssessment(output({ confidence: 1.5 })).ok).toBe(false);
	});

	it("rejects empty reasons", () => {
		expect(validateAssessment(output({ next_action_reason: "" })).ok).toBe(false);
	});

	it("rejects extra fields so a drifting reply is noticed", () => {
		const result = validateAssessment({ ...output(), recommendation: "merge it" });

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.issues.join(" ")).toContain("recommendation");
	});

	it("collects every problem at once", () => {
		const result = validateAssessment({ ...output(), effort: "XXL", confidence: 4 });

		expect(result.ok === false && result.issues.length).toBe(2);
	});

	it("rejects a reply that is not an object", () => {
		expect(validateAssessment("nope").ok).toBe(false);
	});
});

describe("assessmentJsonSchema", () => {
	it("is an object schema listing every field as required", () => {
		const schema = assessmentJsonSchema as {
			type: string;
			required: string[];
			additionalProperties: boolean;
			properties: Record<string, { enum?: string[] }>;
		};

		expect(schema.type).toBe("object");
		expect(schema.additionalProperties).toBe(false);
		expect(schema.required).toContain("next_action");
		expect(schema.required).toContain("evidence");
		expect(schema.properties["next_action"]?.enum).toContain("nudge_author");
		expect(schema.properties["effort"]?.enum).toEqual(["XS", "S", "M", "L", "XL"]);
	});
});
