import { READ_ONLY_INSTRUCTION } from "../agents/instructions.js";
import type { EffortLevel } from "../agents/types.js";
import type { PullRequestBundle } from "../github/client.js";

/** Bumped whenever the wording changes. */
export const REVIEW_PROMPT_VERSION = 2;

export interface ReviewPromptInput {
	bundle: PullRequestBundle;
	defaultBranch: string;
	/** The repository's free-text `review_instructions` from the config file. */
	reviewInstructions?: string | undefined;
	/** How hard to look; the same word the review profile uses, or nothing when the agent decides. */
	effort?: EffortLevel | undefined;
}

const DEFAULT_INSTRUCTIONS = `Review the change on its merits: correctness, edge cases, tests,
public API, performance where it matters, and whether it fits the surrounding code. Do not comment
on formatting a linter would catch.`;

/**
 * The review is the agent's own Markdown, shaped by the repository's instructions or skill, and
 * the app's frame around it only asks for the two things it shows beside the prose: the verdict
 * the agent would submit and a one-line summary. Whatever the instructions say about the reply's
 * format is redirected at the body, so a skill that ends with "reply in Markdown, no JSON" still
 * comes back as the JSON the runner can read.
 */
export function buildReviewPrompt(input: ReviewPromptInput): string {
	const { facts } = input.bundle;

	return `You are drafting a code review of one pull request for the maintainer to read, edit and
post themselves. The draft is never posted automatically.

${READ_ONLY_INSTRUCTION}

Your working directory is a worktree checked out at the pull request's head commit
(${facts.headSha}). The base branch is ${facts.baseRef} and the repository's default branch is
${input.defaultBranch}. Read as much of the code as you need. Put ${effortWord(input.effort)} into
this review.

<review-instructions>
${(input.reviewInstructions ?? DEFAULT_INSTRUCTIONS).trim()}
</review-instructions>

<pull-request>
${facts.repository}#${String(facts.number)}: ${facts.title}
${facts.url}
by ${facts.author}${facts.isBot ? " (bot)" : ""} (${facts.authorAssociation}), ${facts.isDraft ? "draft, " : ""}+${String(
		facts.additions,
	)} -${String(facts.deletions)} across ${String(facts.changedFiles)} files
checks: ${facts.checks.state}
</pull-request>

<description>
${input.bundle.body.trim() || "(empty)"}
</description>

<existing-review-comments>
${existingComments(input.bundle) || "(none)"}
</existing-review-comments>

Write the review as Markdown and put it, whole, in the \`body\` field: that is what the maintainer
reads and pastes into GitHub's review box. The review instructions decide its shape. Where they say
nothing about it, group the findings under a \`###\` heading per severity, worst first — Blocker,
Major, Minor, Nit, Question — each finding a bullet with a bold title and its file and line in
backticks, and leave out a severity with nothing under it. Anchor every finding to a file, and to
a line where you can. Say what is wrong and why it matters, not just that it is wrong. Say plainly
when the change is fine.

Then judge your own review. \`verdict\` is what you would submit on GitHub: approve, comment or
request_changes. \`summary\` is one or two sentences saying what the maintainer will find in the
review; it is shown beside the review, not in it.

Reply with the JSON object the output schema describes and nothing else. Whatever the review
instructions say about the reply's format — Markdown, no JSON, no code fence — applies to the
\`body\` alone; the reply itself is the JSON object.`;
}

/** Turns the reasoning level into words, so the prompt says what the setting means. */
function effortWord(effort: EffortLevel | undefined): string {
	switch (effort) {
		case "none":
		case "minimal": {
			return "a quick skim";
		}
		case "low": {
			return "a light pass";
		}
		case "high": {
			return "serious effort";
		}
		case "xhigh":
		case "max":
		case "ultra": {
			return "as much effort as it takes";
		}
		default: {
			return "a normal review's effort";
		}
	}
}

function existingComments(bundle: PullRequestBundle): string {
	return bundle.reviewThreads
		.flatMap((thread) =>
			thread.comments.map(
				(comment) =>
					`${thread.path ?? "(no file)"}${thread.isResolved ? " [resolved]" : ""}: ${
						comment.author ?? "unknown"
					}: ${comment.body.trim()}`,
			),
		)
		.join("\n");
}
