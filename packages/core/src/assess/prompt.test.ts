import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PullRequestBundle } from "../github/client.js";
import { READ_ONLY_INSTRUCTION } from "../agents/instructions.js";
import type { Assessment } from "../store/types.js";
import {
	buildAssessmentPrompt,
	buildRetryPrompt,
	type AssessmentPromptInput,
	type AssessmentPromptPullRequest,
} from "./prompt.js";

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
			authorAssociation: "CONTRIBUTOR",
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
			area: "bug_fix",
			relevance: "still_relevant",
			relevanceReason: "The code is still there.",
			status: "waiting_on_maintainer",
			statusReason: "No review yet.",
			effort: "S",
			effortReason: "Two files.",
			priority: "medium",
			priorityReason: "A real bug with a workaround.",
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

/** A prompt over one pull request, the bundle and history overridable in place. */
function input(
	overrides: Partial<AssessmentPromptInput> & Partial<AssessmentPromptPullRequest> = {},
): AssessmentPromptInput {
	const { bundle: only, previousAssessments, ...rest } = overrides;
	return {
		depth: "quick",
		pullRequests: [{ bundle: only ?? bundle(), previousAssessments }],
		defaultBranch: "master",
		...rest,
	};
}

/** A second pull request beside the first, so the prompt carries a chunk. */
function another(): AssessmentPromptPullRequest {
	return {
		bundle: bundle({
			facts: {
				...bundle().facts,
				number: 102,
				title: "Add the frobnicator",
				url: "https://github.com/owner/thing/pull/102",
				headSha: "c".repeat(40),
			},
			body: "Adds a frobnicator.",
			comments: [],
			reviews: [],
			reviewThreads: [],
			diff: null,
			diffOmittedReason: "The diff is 900 kB, over the cut-off.",
		}),
	};
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

	it("matches the recorded prompt for a chunk of pull requests", () => {
		expect(
			buildAssessmentPrompt(
				input({
					pullRequests: [{ bundle: bundle(), previousAssessments: [assessment()] }, another()],
				}),
			),
		).toMatchSnapshot();
	});

	it("gives each pull request its own block, named by number", () => {
		const prompt = buildAssessmentPrompt(
			input({ pullRequests: [{ bundle: bundle() }, another()] }),
		);

		expect(prompt).toContain("You are auditing 2 open pull requests");
		expect(prompt).toContain('<pull-request number="101">');
		expect(prompt).toContain('<pull-request number="102">');
		expect(prompt.indexOf("Fix the off-by-one")).toBeLessThan(
			prompt.indexOf("Add the frobnicator"),
		);
		expect(prompt).toContain("exactly one entry per pull request");
	});

	it("speaks of one pull request when that is all it carries", () => {
		const prompt = buildAssessmentPrompt(input());

		expect(prompt).toContain("You are auditing one open pull request");
		expect(prompt).not.toContain("open pull requests");
	});

	it("lets the agent spread the work across subagents", () => {
		expect(buildAssessmentPrompt(input())).toContain("subagents");
	});

	it("tells the agent to judge each pull request on its own", () => {
		expect(buildAssessmentPrompt(input())).toContain("judge each one on its own");
	});

	it("refuses to build a prompt over nothing", () => {
		expect(() => buildAssessmentPrompt(input({ pullRequests: [] }))).toThrow(RangeError);
	});

	it("leaves priority out of a previous assessment made before it was judged", () => {
		const prompt = buildAssessmentPrompt(
			input({
				previousAssessments: [
					assessment({ verdict: { ...assessment().verdict!, priority: null, priorityReason: "" } }),
				],
			}),
		);

		expect(prompt).toContain("  effort: S — Two files.");
		expect(prompt).not.toContain("  priority:");
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

	it("asks only a thorough pass for the analysis, with its sections and diagrams", () => {
		const thorough = buildAssessmentPrompt(input({ depth: "thorough" }));
		expect(thorough).toContain("`analysis` field as Markdown");
		for (const heading of ["Background", "Intuition", "Walkthrough"]) {
			expect(thorough).toContain(`**${heading}**`);
		}
		expect(thorough).toContain("Mermaid");
		expect(thorough).toContain("It explains; it does not review.");

		expect(buildAssessmentPrompt(input({ depth: "quick" }))).not.toContain("analysis");
	});

	it("matches the recorded prompt for a thorough pass", () => {
		expect(
			buildAssessmentPrompt(
				input({ depth: "thorough", checkout: "pull_request_head", timeoutMinutes: 20 }),
			),
		).toMatchSnapshot();
	});

	it("says where the worktree stands and how long the run has", () => {
		const thorough = buildAssessmentPrompt(
			input({ depth: "thorough", checkout: "pull_request_head", timeoutMinutes: 20 }),
		);
		expect(thorough).toContain("checked out at the pull request's head commit");
		expect(thorough).toContain("You have 20 minutes in all");

		const quick = buildAssessmentPrompt(input({ checkout: "default_branch", timeoutMinutes: 6 }));
		expect(quick).toContain("tip of the repository's");
		expect(quick).toContain("You have 6 minutes in all");

		expect(buildAssessmentPrompt(input())).not.toContain("minutes in all");
	});

	it("leaves out the repository context when there is none", () => {
		expect(buildAssessmentPrompt(input())).not.toContain("<repository-context>");
		expect(buildAssessmentPrompt(input({ repositoryContext: "   " }))).not.toContain(
			"<repository-context>",
		);
	});

	it("carries the thorough instructions on a thorough pass only", () => {
		const thorough = buildAssessmentPrompt(
			input({ depth: "thorough", thoroughInstructions: "Run the test suite." }),
		);
		expect(thorough).toContain(
			"<thorough-instructions>\nRun the test suite.\n</thorough-instructions>",
		);

		expect(
			buildAssessmentPrompt(input({ thoroughInstructions: "Run the test suite." })),
		).not.toContain("<thorough-instructions>");
		expect(
			buildAssessmentPrompt(input({ depth: "thorough", thoroughInstructions: "  " })),
		).not.toContain("<thorough-instructions>");
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

	it("keeps each pull request's history inside its own block", () => {
		const prompt = buildAssessmentPrompt(
			input({
				pullRequests: [{ bundle: bundle(), previousAssessments: [assessment()] }, another()],
			}),
		);

		const history = prompt.indexOf("<previous-assessments>");
		expect(history).toBeGreaterThan(prompt.indexOf('<pull-request number="101">'));
		expect(history).toBeLessThan(prompt.indexOf('<pull-request number="102">'));
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
		const retry = buildRetryPrompt("original prompt", ["#101 effort: invalid value"]);

		expect(retry).toContain("original prompt");
		expect(retry).toContain("- #101 effort: invalid value");
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
