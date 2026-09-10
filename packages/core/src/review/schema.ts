import { z } from "zod";
import type { ReviewFinding } from "../store/types.js";

export const REVIEW_VERDICTS = {
	approve: "Approve",
	comment: "Comment",
	request_changes: "Request changes",
} as const;

export const SEVERITIES = {
	blocker: "Blocker",
	major: "Major",
	minor: "Minor",
	nit: "Nit",
	question: "Question",
} as const;

export type ReviewVerdict = keyof typeof REVIEW_VERDICTS;
export type Severity = keyof typeof SEVERITIES;

export const SEVERITY_ORDER = Object.keys(SEVERITIES) as Severity[];

export const reviewOutput = z.strictObject({
	summary: z.string().min(1).max(4000),
	verdict: z.enum(Object.keys(REVIEW_VERDICTS) as ReviewVerdict[]),
	findings: z
		.array(
			z.strictObject({
				title: z.string().min(1).max(200),
				body: z.string().min(1).max(4000),
				severity: z.enum(SEVERITY_ORDER),
				// Nullable rather than optional: see the note in the assessment schema.
				path: z.string().min(1).nullable(),
				line: z.int().positive().nullable(),
			}),
		)
		.max(50),
});

export type ReviewOutput = z.infer<typeof reviewOutput>;

/** The JSON Schema the agent's answer must conform to. */
export const reviewJsonSchema: unknown = z.toJSONSchema(reviewOutput, { io: "input" });

export type ReviewValidationResult =
	| { ok: true; draft: { summary: string; verdict: ReviewVerdict; findings: ReviewFinding[] } }
	| { ok: false; issues: string[] };

export function validateReview(value: unknown): ReviewValidationResult {
	const result = reviewOutput.safeParse(value);
	if (!result.success) {
		return {
			ok: false,
			issues: result.error.issues.map(
				(issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
			),
		};
	}

	return {
		ok: true,
		draft: {
			summary: result.data.summary,
			verdict: result.data.verdict,
			findings: result.data.findings.map((finding) => ({
				title: finding.title,
				body: finding.body,
				severity: finding.severity,
				path: finding.path ?? undefined,
				line: finding.line ?? undefined,
			})),
		},
	};
}
