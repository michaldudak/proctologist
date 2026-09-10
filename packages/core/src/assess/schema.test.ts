import { describe, expect, it } from "vitest";
import {
	assessmentJsonSchema,
	assessmentJsonSchemaFor,
	thoroughJsonSchema,
	validateAssessment,
	validateAssessmentReply,
} from "./schema.js";

function output(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		next_action: "review",
		next_action_reason: "Nobody has looked at it.",
		area: "bug_fix",
		relevance: "still_relevant",
		relevance_reason: "The branch it patches is still there.",
		status: "waiting_on_maintainer",
		status_reason: "No review yet.",
		effort: "S",
		effort_reason: "Two small files.",
		priority: "high",
		priority_reason: "Users hit it weekly and the fix is ready.",
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
				area: "bug_fix",
				relevance: "still_relevant",
				relevanceReason: "The branch it patches is still there.",
				status: "waiting_on_maintainer",
				statusReason: "No review yet.",
				effort: "S",
				effortReason: "Two small files.",
				priority: "high",
				priorityReason: "Users hit it weekly and the fix is ready.",
				summary: "Fixes an off-by-one.",
				confidence: 0.7,
				evidence: [{ note: "src/thing.ts still has the loop", url: "https://example.test/1" }],
			},
		});
	});

	it("accepts evidence with a null URL and an empty evidence list", () => {
		const result = validateAssessment(
			output({ evidence: [{ note: "nothing to add", url: null }] }),
		);

		expect(result.ok).toBe(true);
		expect(result.ok && result.verdict.evidence[0]?.url).toBeUndefined();
		expect(validateAssessment(output({ evidence: [] })).ok).toBe(true);
	});

	it("rejects evidence that leaves the URL out entirely", () => {
		expect(validateAssessment(output({ evidence: [{ note: "nothing to add" }] })).ok).toBe(false);
	});

	it.each([
		["next_action", "ship_it"],
		["area", "misc"],
		["relevance", "maybe"],
		["status", "unknown"],
		["effort", "XXL"],
		["priority", "urgent"],
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

	it("keeps the analysis of a thorough entry and asks for none of a quick one", () => {
		const thorough = validateAssessment(output({ analysis: "## Background\n\nText." }), "thorough");

		expect(thorough).toMatchObject({ ok: true, analysis: "## Background\n\nText." });
		expect(validateAssessment(output(), "quick")).not.toHaveProperty("analysis");
	});

	it("rejects a thorough entry without an analysis, and a quick one with one", () => {
		const missing = validateAssessment(output(), "thorough");
		expect(missing.ok).toBe(false);
		expect(missing.ok === false && missing.issues.join(" ")).toContain("analysis");

		expect(validateAssessment(output({ analysis: "Text." }), "quick").ok).toBe(false);
	});
});

describe("validateAssessmentReply", () => {
	const entry = (number: number, overrides: Record<string, unknown> = {}) => ({
		number,
		...output(overrides),
	});

	it("gives every pull request its verdict", () => {
		const results = validateAssessmentReply({ assessments: [entry(1), entry(2)] }, [1, 2]);

		expect([...results.keys()]).toEqual([1, 2]);
		expect(results.get(1)?.ok).toBe(true);
		expect(results.get(2)?.ok).toBe(true);
	});

	it("blames a bad entry on its own pull request and keeps the others", () => {
		const results = validateAssessmentReply(
			{ assessments: [entry(1), entry(2, { effort: "XXL" })] },
			[1, 2],
		);

		expect(results.get(1)?.ok).toBe(true);
		const second = results.get(2);
		expect(second?.ok).toBe(false);
		expect(second?.ok === false && second.issues.join(" ")).toContain("effort");
	});

	it("validates every entry at the depth asked for", () => {
		const results = validateAssessmentReply(
			{ assessments: [entry(1, { analysis: "Text." }), entry(2)] },
			[1, 2],
			"thorough",
		);

		expect(results.get(1)).toMatchObject({ ok: true, analysis: "Text." });
		expect(results.get(2)?.ok).toBe(false);
	});

	it("marks a pull request the reply left out", () => {
		const results = validateAssessmentReply({ assessments: [entry(1)] }, [1, 2]);

		expect(results.get(2)).toEqual({
			ok: false,
			issues: ["the reply has no entry for this pull request"],
		});
	});

	it("ignores entries nobody asked for and keeps the first of a repeat", () => {
		const results = validateAssessmentReply(
			{ assessments: [entry(9), entry(1, { summary: "first" }), entry(1, { summary: "second" })] },
			[1],
		);

		expect([...results.keys()]).toEqual([1]);
		const only = results.get(1);
		expect(only?.ok === true && only.verdict.summary).toBe("first");
	});

	it("blames every pull request when the reply is not the object asked for", () => {
		const results = validateAssessmentReply({ verdicts: [] }, [1, 2]);

		expect(results.get(1)?.ok).toBe(false);
		expect(results.get(2)).toEqual(results.get(1));
	});
});

/** The fields one entry of a reply must carry, as the JSON Schema lists them. */
function requiredOfEntry(schema: unknown): string[] {
	return (schema as { properties: { assessments: { items: { required: string[] } } } }).properties
		.assessments.items.required;
}

describe("thoroughJsonSchema", () => {
	it("is the assessment schema with the analysis required as well", () => {
		expect(requiredOfEntry(thoroughJsonSchema)).toEqual([
			...requiredOfEntry(assessmentJsonSchema),
			"analysis",
		]);
		expect(assessmentJsonSchemaFor("thorough")).toBe(thoroughJsonSchema);
		expect(assessmentJsonSchemaFor("quick")).toBe(assessmentJsonSchema);
	});
});

describe("assessmentJsonSchema", () => {
	it("is an object holding one entry per pull request, each listing every field as required", () => {
		const schema = assessmentJsonSchema as {
			type: string;
			required: string[];
			additionalProperties: boolean;
			properties: {
				assessments: {
					type: string;
					items: {
						type: string;
						required: string[];
						additionalProperties: boolean;
						properties: Record<string, { enum?: string[] }>;
					};
				};
			};
		};

		expect(schema.type).toBe("object");
		expect(schema.additionalProperties).toBe(false);
		expect(schema.required).toEqual(["assessments"]);
		expect(schema.properties.assessments.type).toBe("array");

		const entry = schema.properties.assessments.items;
		expect(entry.type).toBe("object");
		expect(entry.additionalProperties).toBe(false);
		expect(entry.required).toContain("number");
		expect(entry.required).toContain("next_action");
		expect(entry.required).toContain("evidence");
		expect(entry.properties["next_action"]?.enum).toContain("nudge_author");
		expect(entry.properties["effort"]?.enum).toEqual(["XS", "S", "M", "L", "XL"]);
		expect(entry.properties["priority"]?.enum).toEqual(["critical", "high", "medium", "low"]);
		expect(entry.required).toContain("priority_reason");
	});
});
