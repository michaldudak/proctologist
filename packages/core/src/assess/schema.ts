import { z } from "zod";
import type { AssessmentVerdict } from "../store/types.js";
import {
	AREA_VALUES,
	EFFORT_VALUES,
	NEXT_ACTION_VALUES,
	PRIORITY_VALUES,
	RELEVANCE_VALUES,
	STATUS_VALUES,
} from "./vocabulary.js";

const reason = z.string().min(1).max(600);

/** One pull request's verdict. Kept flat so the JSON Schema stays simple enough to be obeyed. */
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
	priority: z.enum(PRIORITY_VALUES),
	priority_reason: reason,
	summary: z.string().min(1).max(1000),
	confidence: z.number().min(0).max(1),
	// Nullable rather than optional: the structured-output API requires every property to be listed
	// as required, so "absent" has to be expressed as null.
	evidence: z
		.array(z.strictObject({ note: z.string().min(1).max(400), url: z.string().nullable() }))
		.max(10),
});

export type AssessmentOutput = z.infer<typeof assessmentOutput>;

/**
 * What the agent must return: one entry per pull request it was handed, each naming its number.
 * A thorough pass carries one; a quick pass carries a chunk of them.
 */
export const assessmentReply = z.strictObject({
	assessments: z.array(
		z.strictObject({
			number: z.int().positive(),
			...assessmentOutput.shape,
		}),
	),
});

/** The JSON Schema the agent's answer must conform to. */
export const assessmentJsonSchema: unknown = z.toJSONSchema(assessmentReply, { io: "input" });

export type ValidationResult =
	{ ok: true; verdict: AssessmentVerdict } | { ok: false; issues: string[] };

/** Validates one pull request's entry and converts it to the shape the store keeps. */
export function validateAssessment(value: unknown): ValidationResult {
	const result = assessmentOutput.safeParse(value);
	if (!result.success) {
		return { ok: false, issues: describeIssues(result.error) };
	}
	return { ok: true, verdict: toVerdict(result.data) };
}

/**
 * Validates a whole reply against the pull requests it was meant to cover. Every number asked for
 * gets a result: a verdict, or why there is none, whether the entry was malformed, missing, or the
 * reply as a whole was not what the schema asked for. Entries for numbers nobody asked about are
 * dropped, and the first entry for a number wins over any repeat.
 */
export function validateAssessmentReply(
	value: unknown,
	numbers: number[],
): Map<number, ValidationResult> {
	const results = new Map<number, ValidationResult>();

	const outer = replyShape.safeParse(value);
	if (!outer.success) {
		const issues = describeIssues(outer.error);
		for (const number of numbers) {
			results.set(number, { ok: false, issues });
		}
		return results;
	}

	const wanted = new Set(numbers);
	for (const entry of outer.data.assessments) {
		const number = entryNumber(entry);
		if (number === undefined || !wanted.has(number) || results.has(number)) {
			continue;
		}
		const { number: _number, ...rest } = entry;
		results.set(number, validateAssessment(rest));
	}

	for (const number of numbers) {
		if (!results.has(number)) {
			results.set(number, { ok: false, issues: ["the reply has no entry for this pull request"] });
		}
	}

	return results;
}

/** The reply's outline alone, so a bad entry is reported against its own pull request. */
const replyShape = z.strictObject({
	assessments: z.array(z.looseObject({ number: z.unknown() })),
});

function entryNumber(entry: { number: unknown }): number | undefined {
	return typeof entry.number === "number" && Number.isInteger(entry.number)
		? entry.number
		: undefined;
}

function describeIssues(error: z.ZodError): string[] {
	return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

function toVerdict(output: AssessmentOutput): AssessmentVerdict {
	return {
		nextAction: output.next_action,
		nextActionReason: output.next_action_reason,
		area: output.area,
		relevance: output.relevance,
		relevanceReason: output.relevance_reason,
		status: output.status,
		statusReason: output.status_reason,
		effort: output.effort,
		effortReason: output.effort_reason,
		priority: output.priority,
		priorityReason: output.priority_reason,
		summary: output.summary,
		confidence: output.confidence,
		evidence: output.evidence.map((item) => ({ note: item.note, url: item.url ?? undefined })),
	};
}
