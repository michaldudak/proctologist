import { z } from "zod";
import type { AssessmentDepth, AssessmentVerdict } from "../store/types.js";
import {
	AREA_VALUES,
	EFFORT_VALUES,
	ISSUE_NEXT_ACTION_VALUES,
	ISSUE_STATUS_VALUES,
	ISSUE_TYPE_VALUES,
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
 * One issue's verdict. The shared fields are the same judgments under the same names; what differs
 * is the two vocabularies that are about merging, and the two fields only an issue has.
 */
export const triageOutput = z.strictObject({
	next_action: z.enum(ISSUE_NEXT_ACTION_VALUES),
	next_action_reason: reason,
	type: z.enum(ISSUE_TYPE_VALUES),
	area: z.enum(AREA_VALUES),
	relevance: z.enum(RELEVANCE_VALUES),
	relevance_reason: reason,
	status: z.enum(ISSUE_STATUS_VALUES),
	status_reason: reason,
	effort: z.enum(EFFORT_VALUES),
	effort_reason: reason,
	priority: z.enum(PRIORITY_VALUES),
	priority_reason: reason,
	summary: z.string().min(1).max(1000),
	confidence: z.number().min(0).max(1),
	evidence: z
		.array(z.strictObject({ note: z.string().min(1).max(400), url: z.string().nullable() }))
		.max(10),
	/** Proposed from the index of open titles, so it is a candidate to confirm, not a finding. */
	possible_duplicate_of: z.array(z.int().positive()).max(5),
});

export const thoroughTriageOutput = z.strictObject({
	...triageOutput.shape,
	analysis: z.string().min(1).max(200_000),
});

export const triageReply = z.strictObject({
	assessments: z.array(z.strictObject({ number: z.int().positive(), ...triageOutput.shape })),
});

export const thoroughTriageReply = z.strictObject({
	assessments: z.array(
		z.strictObject({ number: z.int().positive(), ...thoroughTriageOutput.shape }),
	),
});

export const triageJsonSchema: unknown = z.toJSONSchema(triageReply, { io: "input" });
export const thoroughTriageJsonSchema: unknown = z.toJSONSchema(thoroughTriageReply, {
	io: "input",
});

export function triageJsonSchemaFor(depth: AssessmentDepth): unknown {
	return depth === "thorough" ? thoroughTriageJsonSchema : triageJsonSchema;
}

/**
 * A thorough pass also writes the analysis: a long-form Markdown explanation of the change, with
 * Mermaid diagrams where they help. It is bounded generously rather than tightly, since a large
 * change deserves a long explanation and the reader pays nothing for length they skip.
 */
export const thoroughOutput = z.strictObject({
	...assessmentOutput.shape,
	analysis: z.string().min(1).max(200_000),
});

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

export const thoroughReply = z.strictObject({
	assessments: z.array(
		z.strictObject({
			number: z.int().positive(),
			...thoroughOutput.shape,
		}),
	),
});

/** The JSON Schema the agent's answer must conform to. */
export const assessmentJsonSchema: unknown = z.toJSONSchema(assessmentReply, { io: "input" });

export const thoroughJsonSchema: unknown = z.toJSONSchema(thoroughReply, { io: "input" });

export function assessmentJsonSchemaFor(depth: AssessmentDepth): unknown {
	return depth === "thorough" ? thoroughJsonSchema : assessmentJsonSchema;
}

export type ValidationResult =
	/** `analysis` is set exactly when the entry was validated as a thorough one. */
	| { ok: true; verdict: AssessmentVerdict; analysis?: string | undefined }
	| { ok: false; issues: string[] };

/** Validates one issue's entry and converts it to the shape the store keeps. */
export function validateTriage(value: unknown, depth: AssessmentDepth = "quick"): ValidationResult {
	const shape = depth === "thorough" ? thoroughTriageOutput : triageOutput;
	const result = shape.safeParse(value);
	if (!result.success) {
		return { ok: false, issues: describeIssues(result.error) };
	}
	const verdict = toVerdict(result.data as unknown as AssessmentOutput);
	return depth === "thorough"
		? { ok: true, verdict, analysis: (result.data as unknown as { analysis: string }).analysis }
		: { ok: true, verdict };
}

/** Validates one pull request's entry and converts it to the shape the store keeps. */
export function validateAssessment(
	value: unknown,
	depth: AssessmentDepth = "quick",
): ValidationResult {
	if (depth === "thorough") {
		const result = thoroughOutput.safeParse(value);
		if (!result.success) {
			return { ok: false, issues: describeIssues(result.error) };
		}
		return { ok: true, verdict: toVerdict(result.data), analysis: result.data.analysis };
	}
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
	depth: AssessmentDepth = "quick",
	validate: (entry: unknown, depth: AssessmentDepth) => ValidationResult = validateAssessment,
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
		results.set(number, validate(rest, depth));
	}

	for (const number of numbers) {
		if (!results.has(number)) {
			results.set(number, { ok: false, issues: ["the reply has no entry for this item"] });
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
		type: "type" in output ? ((output as { type: string }).type ?? null) : null,
		possibleDuplicateOf:
			"possible_duplicate_of" in output
				? ((output as { possible_duplicate_of: number[] }).possible_duplicate_of ?? [])
				: [],
	};
}
