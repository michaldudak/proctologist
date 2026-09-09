import { READ_ONLY_INSTRUCTION } from "../codex/instructions.js";
import type { ReasoningEffort } from "../config/schema.js";
import type { PullRequestBundle } from "../github/client.js";

/** Bumped whenever the wording changes. */
export const REVIEW_PROMPT_VERSION = 1;

export interface ReviewPromptInput {
	bundle: PullRequestBundle;
	defaultBranch: string;
	/** The repository's free-text `review_instructions` from the config file. */
	reviewInstructions?: string | undefined;
	/** How hard to look; the same word the Codex profile uses. */
	effort: ReasoningEffort;
}

const DEFAULT_INSTRUCTIONS = `Review the change on its merits: correctness, edge cases, tests,
public API, performance where it matters, and whether it fits the surrounding code. Do not comment
on formatting a linter would catch.`;

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
by ${facts.author}${facts.isBot ? " (bot)" : ""}, ${facts.isDraft ? "draft, " : ""}+${String(
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

Anchor every finding to a file, and to a line where you can. Say what is wrong and why it matters,
not just that it is wrong. Leave the findings list empty when the change is fine.

Reply with the JSON object the output schema describes and nothing else.`;
}

function effortWord(effort: ReasoningEffort): string {
	switch (effort) {
		case "minimal": {
			return "a quick skim";
		}
		case "low": {
			return "a light pass";
		}
		case "high": {
			return "serious effort";
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
