import { describe, expect, it } from "vitest";
import { READ_ONLY_INSTRUCTION } from "../codex/instructions.js";
import type { PullRequestBundle } from "../github/client.js";
import type { ReviewDraft } from "../store/types.js";
import { toMarkdown } from "./markdown.js";
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
			authoredByUser: false,
			reviewRequestedFromUser: true,
			createdAt: "2026-08-01T09:00:00Z",
			updatedAt: "2026-09-01T09:00:00Z",
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

function output(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		summary: "Close, two things to fix.",
		verdict: "request_changes",
		findings: [
			{
				title: "Unchecked index",
				body: "The loop can read past the end.",
				severity: "blocker",
				path: "src/thing.ts",
				line: 12,
			},
		],
		...overrides,
	};
}

describe("validateReview", () => {
	it("converts a valid reply to the stored shape", () => {
		const result = validateReview(output());

		expect(result).toEqual({
			ok: true,
			draft: {
				summary: "Close, two things to fix.",
				verdict: "request_changes",
				findings: [
					{
						title: "Unchecked index",
						body: "The loop can read past the end.",
						severity: "blocker",
						path: "src/thing.ts",
						line: 12,
					},
				],
			},
		});
	});

	it("accepts a review with nothing to say", () => {
		expect(validateReview(output({ verdict: "approve", findings: [] })).ok).toBe(true);
	});

	it("accepts a finding with no file, and drops the nulls on the way in", () => {
		const result = validateReview(
			output({
				findings: [{ title: "t", body: "b", severity: "question", path: null, line: null }],
			}),
		);

		expect(result.ok).toBe(true);
		expect(result.ok && result.draft.findings[0]?.path).toBeUndefined();
	});

	it("rejects a finding that leaves the file out entirely", () => {
		expect(
			validateReview(output({ findings: [{ title: "t", body: "b", severity: "question" }] })).ok,
		).toBe(false);
	});

	it.each([
		["verdict", "lgtm"],
		["findings", [{ title: "t", body: "b", severity: "catastrophic", path: null, line: null }]],
	])("rejects an invalid %s", (field, value) => {
		const result = validateReview(output({ [field]: value }));

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.issues.join(" ")).toContain(field);
	});

	it("rejects a line number that is not a positive integer", () => {
		expect(
			validateReview(output({ findings: [{ title: "t", body: "b", severity: "nit", line: 0 }] }))
				.ok,
		).toBe(false);
	});

	it("produces a JSON schema with the verdicts and severities", () => {
		const schema = reviewJsonSchema as {
			properties: { verdict: { enum: string[] } };
			required: string[];
		};

		expect(schema.properties.verdict.enum).toEqual(["approve", "comment", "request_changes"]);
		expect(schema.required).toEqual(["summary", "verdict", "findings"]);
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

function draft(overrides: Partial<ReviewDraft> = {}): ReviewDraft {
	return {
		id: 1,
		repository: "owner/thing",
		kind: "pull_request",
		number: 101,
		headSha: "a",
		summary: "Close, two things to fix.",
		verdict: "request_changes",
		findings: [
			{
				title: "Unchecked index",
				body: "The loop can read past the end.",
				severity: "blocker",
				path: "src/thing.ts",
				line: 12,
			},
			{ title: "Spelling", body: "recieve", severity: "nit", path: "README.md" },
		],
		sessionId: null,
		model: null,
		createdAt: "2026-09-09T12:00:00.000Z",
		...overrides,
	};
}

describe("toMarkdown", () => {
	it("groups findings by severity, worst first", () => {
		expect(toMarkdown(draft())).toBe(
			[
				"**Request changes** — Close, two things to fix.",
				"",
				"### Blocker",
				"",
				"- **Unchecked index** — `src/thing.ts:12`",
				"  The loop can read past the end.",
				"",
				"### Nit",
				"",
				"- **Spelling** — `README.md`",
				"  recieve",
				"",
			].join("\n"),
		);
	});

	it("prints just the summary when there is nothing to fix", () => {
		expect(toMarkdown(draft({ verdict: "approve", findings: [] }))).toBe(
			"**Approve** — Close, two things to fix.\n",
		);
	});

	it("keeps a severity it does not recognise", () => {
		const markdown = toMarkdown(
			draft({ findings: [{ title: "t", body: "b", severity: "unheard-of" }] }),
		);

		expect(markdown).toContain("### unheard-of");
	});
});
