import { READ_ONLY_INSTRUCTION } from "../codex/instructions.js";
import type { AssessmentDepth } from "../store/types.js";

/** Bumped whenever the wording changes, so stored assessments can be traced to a prompt. */
export const ASSESSMENT_PROMPT_VERSION = 2;

const CRITERIA = `Judge the pull request from the perspective of a maintainer of the repository who
has to decide what to do with it. Fill in every field.

**category** — what kind of change this is: feature, bug_fix, experiment, refactor_chore, docs,
dependency_infra, test, or other when none fits.

**relevance** — whether the change still matters against the current default branch. Check whether
the problem was already fixed elsewhere, whether the files it touches still exist, and whether the
feature it adds is already there. still_relevant, possibly_obsolete, likely_obsolete, or unclear
when you could not tell. Cite what you actually looked at in the reason.

**status** — where the pull request is stuck. ready_to_merge when it is complete, approved or
uncontroversial, and green. waiting_on_maintainer when the ball is with the repository's
maintainers, for example an unreviewed pull request or an answered review. waiting_on_author when
review comments, failing checks or conflicts are the author's to resolve. blocked_on_discussion
when a design question is open. stalled when nobody has moved it for a long time and nobody appears
to be waiting on anyone.

**effort** — how much maintainer time it would take to get this to merged or closed, not how large
the diff is. XS is minutes, S under an hour, M half a day, L a day or more, XL a project.

**next_action** — the single next thing the maintainer should do:
- merge: it is ready, just merge it.
- review: it needs the maintainer's review before anything else can happen.
- continue: the maintainer authored it and should carry on with it.
- nudge_author: it is waiting on the author and they need a reminder.
- close: it should be closed, because it is obsolete, superseded, or out of scope.
- decide: a question needs an answer from the maintainer before the work can continue.
- wait: nothing to do yet, for example checks are still running or a dependency is pending.
Use continue only for pull requests the maintainer authored.

**summary** — one or two sentences on what the pull request does. No preamble.

**confidence** — 0 to 1, how sure you are of the verdicts given what you could see.

**evidence** — up to ten short notes on what you checked, each with a URL when there is a useful one
and null otherwise. Write them as observations, not as remarks about this prompt: "src/thing.ts no
longer contains the branch this patches", never "the supplied diff shows".

Judge from the material below and the code in the worktree. Do not lean on notes or memories from
earlier sessions: two runs over the same pull request should reach the same verdict.`;

const QUICK = `This is a quick pass over every open pull request, so be economical: at most a few
shell commands, and only when the bundle below leaves a real question open. Do not build, install
dependencies, or run tests. When the material below is not enough to be sure, say so through a lower
confidence rather than by digging.`;

const THOROUGH = `This is a deliberate second look at one pull request, so investigate properly.
You may read widely in the worktree, run builds and tests, and create scratch worktrees. Verify the
claims the pull request makes: whether the bug is actually fixed, whether the feature already
exists, whether the tests cover it. Spend the effort; a slow, well-evidenced answer is what is
wanted here.`;

export interface InstructionOptions {
	/** False when no local clone is configured, so the working directory is an empty folder. */
	hasWorkingCopy?: boolean;
}

export function assessmentInstructions(
	depth: AssessmentDepth,
	options: InstructionOptions = {},
): string {
	const workingCopy =
		options.hasWorkingCopy === false
			? `Your working directory is empty: no local clone is configured for this repository, so you
cannot read the code. Judge from the material below alone and lower your confidence accordingly.`
			: `Your working directory is a worktree already checked out at the tip of the repository's
default branch, so read files there directly. Do not read through a remote-tracking ref such as
\`origin/master\`: the clone may have several remotes and \`origin\` is often a fork.`;

	return `You are auditing one open pull request of a GitHub repository.

${READ_ONLY_INSTRUCTION}

${depth === "thorough" ? THOROUGH : QUICK}

${workingCopy} Everything known about the pull request is below; the diff may have been left out
if it was too large, in which case the file list stands in for it.

${CRITERIA}

Reply with the JSON object the output schema describes and nothing else.`;
}
