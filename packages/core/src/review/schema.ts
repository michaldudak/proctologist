import { z } from "zod";

export const REVIEW_VERDICTS = {
	approve: "Approve",
	comment: "Comment",
	request_changes: "Request changes",
} as const;

export type ReviewVerdict = keyof typeof REVIEW_VERDICTS;

/**
 * The review itself is Markdown in one `body` field, in whatever shape the repository's own
 * instructions or skill ask for; the two fields beside it are the agent's judgement of what it
 * wrote, so the panel can show a verdict and a one-liner without parsing the prose. The body is
 * bounded generously, like the analysis: a long review costs the reader nothing they skip.
 */
export const reviewOutput = z.strictObject({
	body: z.string().min(1).max(200_000),
	verdict: z.enum(Object.keys(REVIEW_VERDICTS) as ReviewVerdict[]),
	summary: z.string().min(1).max(4000),
});

export type ReviewOutput = z.infer<typeof reviewOutput>;

/** The JSON Schema the agent's answer must conform to. */
export const reviewJsonSchema: unknown = z.toJSONSchema(reviewOutput, { io: "input" });

export type ReviewValidationResult =
	| { ok: true; draft: { body: string; verdict: ReviewVerdict; summary: string } }
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
			body: result.data.body,
			verdict: result.data.verdict,
			summary: result.data.summary,
		},
	};
}
