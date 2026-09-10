import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PullRequestBundle } from "../github/client.js";
import { READ_ONLY_INSTRUCTION } from "../agents/instructions.js";
import type { Assessment } from "../store/types.js";
import { buildAssessmentPrompt, buildRetryPrompt, type AssessmentPromptInput } from "./prompt.js";

const here = path.dirname(fileURLToPath(import.meta.url));

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
			labels: ["bug"],
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
		comments: [
			{ author: "contributor", createdAt: "2026-09-02T10:00:00Z", body: "Any chance of a review?" },
		],
		reviews: [
			{
				author: "maintainer",
				state: "COMMENTED",
				submittedAt: "2026-09-03T08:00:00Z",
				body: "One question.",
			},
		],
		reviewThreads: [
			{
				path: "src/thing.ts",
				isResolved: false,
				isOutdated: false,
				comments: [
					{ author: "maintainer", createdAt: "2026-09-03T08:00:00Z", body: "Why the cast?" },
				],
			},
		],
		files: [{ path: "src/thing.ts", additions: 12, deletions: 3 }],
		diff: "diff --git a/src/thing.ts b/src/thing.ts\n@@ -1 +1 @@\n-old\n+new\n",
		diffOmittedReason: null,
		filesTruncated: false,
		...overrides,
	};
}

function assessment(overrides: Partial<Assessment> = {}): Assessment {
	return {
		id: 1,
		repository: "owner/thing",
		kind: "pull_request",
		number: 101,
		depth: "quick",
		headSha: "b".repeat(40),
		updatedAtSeen: "2026-08-20T09:00:00Z",
		verdict: {
			nextAction: "review",
			nextActionReason: "Nobody has looked at it.",
			category: "bug_fix",
			relevance: "still_relevant",
			relevanceReason: "The code is still there.",
			status: "waiting_on_maintainer",
			statusReason: "No review yet.",
			effort: "S",
			effortReason: "Two files.",
			summary: "Fixes an off-by-one.",
			confidence: 0.7,
			evidence: [],
		},
		error: null,
		agent: "codex",
		model: null,
		durationMs: null,
		createdAt: "2026-08-20T10:00:00Z",
		...overrides,
	};
}

function input(overrides: Partial<AssessmentPromptInput> = {}): AssessmentPromptInput {
	return { depth: "quick", bundle: bundle(), defaultBranch: "master", ...overrides };
}

describe("buildAssessmentPrompt", () => {
	it("matches the recorded prompt for a quick pass", () => {
		expect(
			buildAssessmentPrompt(
				input({
					repositoryContext: "This repository ships a component library.",
					previousAssessments: [assessment()],
				}),
			),
		).toMatchSnapshot();
	});

	it("always carries the read-only instruction", () => {
		for (const depth of ["quick", "thorough"] as const) {
			expect(buildAssessmentPrompt(input({ depth }))).toContain(READ_ONLY_INSTRUCTION);
		}
	});

	it("tells a quick pass to be economical and a thorough one to dig", () => {
		expect(buildAssessmentPrompt(input({ depth: "quick" }))).toContain("at most a few");
		expect(buildAssessmentPrompt(input({ depth: "thorough" }))).toContain("run builds and tests");
	});

	it("leaves out the repository context when there is none", () => {
		expect(buildAssessmentPrompt(input())).not.toContain("<repository-context>");
		expect(buildAssessmentPrompt(input({ repositoryContext: "   " }))).not.toContain(
			"<repository-context>",
		);
	});

	it("says when the file list was cut off", () => {
		const prompt = buildAssessmentPrompt(input({ bundle: bundle({ filesTruncated: true }) }));

		expect(prompt).toContain("the list is cut off");
	});

	it("says why the diff is missing and still lists the files", () => {
		const prompt = buildAssessmentPrompt(
			input({
				bundle: bundle({ diff: null, diffOmittedReason: "The diff is 900 kB, over the cut-off." }),
			}),
		);

		expect(prompt).toContain("(omitted) The diff is 900 kB");
		expect(prompt).toContain("src/thing.ts +12 -3");
	});

	it("reduces earlier assessments to their verdicts and keeps only the last two", () => {
		const prompt = buildAssessmentPrompt(
			input({
				previousAssessments: [
					assessment({ id: 3, createdAt: "2026-08-30T10:00:00Z" }),
					assessment({ id: 2, createdAt: "2026-08-20T10:00:00Z" }),
					assessment({ id: 1, createdAt: "2026-08-10T10:00:00Z" }),
				],
			}),
		);

		expect(prompt).toContain("2026-08-30T10:00:00Z");
		expect(prompt).toContain("2026-08-20T10:00:00Z");
		expect(prompt).not.toContain("2026-08-10T10:00:00Z");
	});

	it("records an earlier failure rather than pretending there was no assessment", () => {
		const prompt = buildAssessmentPrompt(
			input({ previousAssessments: [assessment({ verdict: null, error: "timed out" })] }),
		);

		expect(prompt).toContain("no assessment — timed out");
	});

	it("copes with a pull request nobody has touched", () => {
		const prompt = buildAssessmentPrompt(
			input({ bundle: bundle({ body: "", comments: [], reviews: [], reviewThreads: [] }) }),
		);

		expect(prompt).toContain("<body>\n(empty)\n</body>");
		expect(prompt).toContain("<comments>\n(none)\n</comments>");
	});
});

describe("buildRetryPrompt", () => {
	it("appends what was wrong with the first reply", () => {
		const retry = buildRetryPrompt("original prompt", ["effort: invalid value"]);

		expect(retry).toContain("original prompt");
		expect(retry).toContain("- effort: invalid value");
		expect(retry).toContain("valid JSON object");
	});
});

describe("private notes", () => {
	it("is never read by the prompt builder", async () => {
		const source = await readFile(path.join(here, "prompt.ts"), "utf8");
		const code = source.replaceAll(/\/\*\*[\s\S]*?\*\/|\/\/.*$/gm, "");

		expect(code).not.toMatch(/\bnotes?\b/i);
	});
});
