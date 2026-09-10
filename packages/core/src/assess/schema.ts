import { z } from "zod";
import type { AssessmentVerdict } from "../store/types.js";
import {
	AREA_VALUES,
	EFFORT_VALUES,
	NEXT_ACTION_VALUES,
	RELEVANCE_VALUES,
	STATUS_VALUES,
} from "./vocabulary.js";

const reason = z.string().min(1).max(600);

/** What the agent must return. Kept flat so the JSON Schema stays simple enough to be obeyed. */
export const assessmentOutput = z.strictObject({
	next_action: z.enum(NEXT_ACTION_VALUES),
	next_action_reason: reason,
	area: z.enum(AREA_VALUES),
	relevance: z.enum(RELEVANCE_VALUES),
	relevance_reason: reason,
	status: z.enum(STATUS_VALUES),
	status_reason: reason,
	effort: z.enum(EFFORT_VALUES),
	effort_reason: reason,
	summary: z.string().min(1).max(1000),
	confidence: z.number().min(0).max(1),
	// Nullable rather than optional: the structured-output API requires every property to be listed
	// as required, so "absent" has to be expressed as null.
	evidence: z
		.array(z.strictObject({ note: z.string().min(1).max(400), url: z.string().nullable() }))
		.max(10),
});

export type AssessmentOutput = z.infer<typeof assessmentOutput>;

/** The JSON Schema the agent's answer must conform to. */
export const assessmentJsonSchema: unknown = z.toJSONSchema(assessmentOutput, { io: "input" });

export type ValidationResult =
	{ ok: true; verdict: AssessmentVerdict } | { ok: false; issues: string[] };

/** Validates what the agent returned and converts it to the shape the store keeps. */
export function validateAssessment(value: unknown): ValidationResult {
	const result = assessmentOutput.safeParse(value);
	if (!result.success) {
		return {
			ok: false,
			issues: result.error.issues.map(
				(issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
			),
		};
	}

	const output = result.data;
	return {
		ok: true,
		verdict: {
			nextAction: output.next_action,
			nextActionReason: output.next_action_reason,
			area: output.area,
			relevance: output.relevance,
			relevanceReason: output.relevance_reason,
			status: output.status,
			statusReason: output.status_reason,
			effort: output.effort,
			effortReason: output.effort_reason,
			summary: output.summary,
			confidence: output.confidence,
			evidence: output.evidence.map((item) => ({ note: item.note, url: item.url ?? undefined })),
		},
	};
}
