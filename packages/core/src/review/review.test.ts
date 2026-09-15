import { describe, expect, it } from "vitest";
import { READ_ONLY_INSTRUCTION } from "../agents/instructions.js";
import type { PullRequestBundle } from "../github/client.js";
import { buildReviewPrompt } from "./prompt.js";
import { reviewJsonSchema, validateReview } from "./schema.js";

function bundle(overrides: Partial<PullRequestBundle> = {}): PullRequestBundle {
	return {
		facts: {
			repository: "owner/thing",
			kind: "pull_request",
			number: 101,
			title: "Fix the off-by-one",
			url: "https://github.com/owner/thing/pull/101",
			author: "contributor",
			isBot: false,
			authorAssociation: "CONTRIBUTOR",
			authoredByUser: false,
			reviewRequestedFromUser: true,
			createdAt: "2026-08-01T09:00:00Z",
			updatedAt: "2026-09-01T09:00:00Z",
			changedAt: "2026-09-01T09:00:00Z",
			isDraft: false,
			labels: [],
			headSha: "a".repeat(40),
			baseRef: "master",
			additions: 12,
			deletions: 3,
			changedFiles: 2,
			mergeable: "MERGEABLE",
			reviewDecision: null,
			checks: { state: "passing", passed: 4, failed: 0, pending: 0 },
			lastActivityBy: "contributor",
			lastActivityAt: "2026-09-02T10:00:00Z",
			lastActivityByUser: false,
		},
		body: "This fixes the thing.",
		comments: [],
		reviews: [],
		reviewThreads: [
			{
				path: "src/thing.ts",
				isResolved: true,
				isOutdated: false,
				comments: [
					{ author: "maintainer", createdAt: "2026-09-03T08:00:00Z", body: "Why the cast?" },
				],
			},
		],
		files: [],
		diff: null,
		diffOmittedReason: null,
		filesTruncated: false,
		...overrides,
	};
}

const BODY =
	"### Blocker\n\n- **Unchecked index** — `src/thing.ts:12`\n  The loop can read past the end.";

function output(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		body: BODY,
		verdict: "request_changes",
		summary: "Close, two things to fix.",
		...overrides,
	};
}

describe("validateReview", () => {
	it("converts a valid reply to the stored shape", () => {
		expect(validateReview(output())).toEqual({
			ok: true,
			draft: { body: BODY, verdict: "request_changes", summary: "Close, two things to fix." },
		});
	});

	it("keeps the body exactly as written, whatever shape it takes", () => {
		const body = "# PR review\n\nNo findings.\n\n## Verdict\n\n**Approve** - nothing to fix.\n";

		const result = validateReview(output({ body, verdict: "approve" }));

		expect(result.ok && result.draft.body).toBe(body);
	});

	it.each([
		["verdict", "lgtm"],
		["body", ""],
		["summary", 42],
	])("rejects an invalid %s", (field, value) => {
		const result = validateReview(output({ [field]: value }));

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.issues.join(" ")).toContain(field);
	});

	it("rejects the findings list an older prompt asked for", () => {
		expect(validateReview(output({ findings: [] })).ok).toBe(false);
	});

	it("produces a JSON schema that asks for the body before the judgement of it", () => {
		const schema = reviewJsonSchema as {
			properties: { verdict: { enum: string[] } };
			required: string[];
		};

		expect(schema.properties.verdict.enum).toEqual(["approve", "comment", "request_changes"]);
		expect(schema.required).toEqual(["body", "verdict", "summary"]);
	});
});

describe("buildReviewPrompt", () => {
	it("matches the recorded prompt", () => {
		expect(
			buildReviewPrompt({
				bundle: bundle(),
				defaultBranch: "master",
				reviewInstructions: "Use the house review skill on medium effort.",
				effort: "high",
			}),
		).toMatchSnapshot();
	});

	it("carries the read-only instruction", () => {
		expect(
			buildReviewPrompt({ bundle: bundle(), defaultBranch: "master", effort: "medium" }),
		).toContain(READ_ONLY_INSTRUCTION);
	});

	it("wraps the repository's own instructions rather than replacing the frame", () => {
		const prompt = buildReviewPrompt({
			bundle: bundle(),
			defaultBranch: "master",
			reviewInstructions: "Use the house review skill.",
			effort: "medium",
		});

		expect(prompt).toContain("<review-instructions>\nUse the house review skill.");
		expect(prompt).toContain("Reply with the JSON object");
	});

	it("lets the instructions shape the body, and keeps the reply itself as JSON", () => {
		const prompt = buildReviewPrompt({ bundle: bundle(), defaultBranch: "master" });

		expect(prompt).toContain("The review instructions decide its shape.");
		expect(prompt).toContain("`body` alone; the reply itself is the JSON object.");
	});

	it("falls back to general instructions when the repository has none", () => {
		expect(
			buildReviewPrompt({ bundle: bundle(), defaultBranch: "master", effort: "medium" }),
		).toContain("Review the change on its merits");
	});

	it("says how much effort to put in", () => {
		expect(
			buildReviewPrompt({ bundle: bundle(), defaultBranch: "master", effort: "high" }),
		).toContain("serious effort");
		expect(
			buildReviewPrompt({ bundle: bundle(), defaultBranch: "master", effort: "low" }),
		).toContain("a light pass");
	});

	it("includes the review comments already on the pull request", () => {
		expect(
			buildReviewPrompt({ bundle: bundle(), defaultBranch: "master", effort: "medium" }),
		).toContain("src/thing.ts [resolved]: maintainer: Why the cast?");
	});
});
