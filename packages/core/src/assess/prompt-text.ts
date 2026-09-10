import { READ_ONLY_INSTRUCTION } from "../agents/instructions.js";
import type { AssessmentDepth } from "../store/types.js";

/** Bumped whenever the wording changes, so stored assessments can be traced to a prompt. */
export const ASSESSMENT_PROMPT_VERSION = 5;

const CRITERIA = `Judge each pull request from the perspective of a maintainer of the repository who
has to decide what to do with it. Fill in every field.

**area** — what kind of change this is: feature, bug_fix, experiment, refactor_chore, docs,
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

**priority** — how urgent and how important it is that the maintainer deals with this, judged on
its own: it is not the effort, and it is not the next action. A pull request that should be closed
can still be critical when leaving it open misleads people, and a merge-ready one can be low.
- critical: something is broken, unsafe or leaking for users right now, a release is blocked, or a
  regression has shipped and this is the fix. Deal with it today.
- high: important and time-sensitive, for example a much-requested feature that is ready, a fix
  for a real bug with a workaround, or a contributor who will drift away if not answered soon.
- medium: worth doing and nobody is hurt by waiting a few weeks.
- low: nice to have, cosmetic, speculative, or already superseded; nothing is lost if it waits
  indefinitely.
Name in the reason what is at stake and for whom, and what changes if it waits.

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
earlier sessions: two runs over the same pull request should reach the same verdict. Pull requests
that arrive together are only sharing a trip; judge each one on its own, and never let one's verdict
colour another's.`;

const QUICK = `This is a quick pass over every open pull request, so be economical: at most a few
shell commands per pull request, and only when its bundle below leaves a real question open. Do not
build, install dependencies, or run tests. When the material below is not enough to be sure, say so
through a lower confidence rather than by digging.`;

const THOROUGH = `This is a deliberate second look at one pull request, so investigate properly.
You may read widely in the worktree, run builds and tests, and create scratch worktrees. Verify the
claims the pull request makes: whether the bug is actually fixed, whether the feature already
exists, whether the tests cover it. Spend the effort; a slow, well-evidenced answer is what is
wanted here.`;

const SUBAGENTS = `You may hand pull requests to subagents to finish sooner, at your discretion and only when your
tooling offers them; every rule here binds them too, and it is you who collects their findings and
writes the one reply.`;

export interface InstructionOptions {
	/** False when no local clone is configured, so the working directory is an empty folder. */
	hasWorkingCopy?: boolean;
	/** How many pull requests the prompt carries. One unless a quick pass bundled several. */
	count?: number;
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

	const count = options.count ?? 1;
	const several = count > 1;
	const these = several ? `${String(count)} open pull requests` : "one open pull request";
	const material = several
		? "Everything known about each pull request is in its own block below"
		: "Everything known about the pull request is below";

	return `You are auditing ${these} of a GitHub repository.

${READ_ONLY_INSTRUCTION}

${depth === "thorough" ? THOROUGH : QUICK}

${SUBAGENTS}

${workingCopy} ${material}; the diff may have been left out
if it was too large, in which case the file list stands in for it.

${CRITERIA}

Reply with the JSON object the output schema describes and nothing else: an \`assessments\` array
holding exactly one entry per pull request below, each carrying that pull request's \`number\`.`;
}
