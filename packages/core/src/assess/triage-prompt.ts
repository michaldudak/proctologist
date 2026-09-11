import { READ_ONLY_INSTRUCTION } from "../agents/instructions.js";
import type { IssueBundle } from "../github/client.js";
import type { Assessment, AssessmentDepth } from "../store/types.js";

/**
 * Versioned apart from the assessment prompt, so tuning triage does not mark every stored pull
 * request assessment as made against an older prompt.
 */
export const TRIAGE_PROMPT_VERSION = 1;

/** One issue as the prompt carries it. */
export interface TriagePromptIssue {
	bundle: IssueBundle;
	/** The two most recent assessments, newest first. Reduced to verdicts, reasons and summary. */
	previousAssessments?: Assessment[] | undefined;
}

export interface TriagePromptInput {
	depth: AssessmentDepth;
	issues: TriagePromptIssue[];
	repository: string;
	/**
	 * Number and title of the repository's other open issues, most recent first, so the agent can
	 * propose duplicates. A per-item pass cannot find them any other way.
	 */
	duplicateIndex?: { number: number; title: string }[] | undefined;
	repositoryContext?: string | undefined;
	thoroughInstructions?: string | undefined;
	/** A thorough triage gets a checkout of the default branch; a quick one gets no code at all. */
	hasWorkingCopy?: boolean | undefined;
	timeoutMinutes?: number | undefined;
}

const PREVIOUS_ASSESSMENT_COUNT = 2;
const DUPLICATE_INDEX_LIMIT = 400;

const CRITERIA = `
Judge each issue from the maintainer's side of the table: what should they do about it, how badly,
and what would it cost.

next_action — the single thing the maintainer should do next.
  fix           the report is understood and the change is theirs to make
  answer        a reply settles it: a question, a misunderstanding, a pointer to the docs
  close_duplicate
                the same report already exists, and the other one is where the work should happen.
                Only when possible_duplicate_of names it and you are sure enough to say so: this
                is the one action that disposes of an issue on the strength of the index alone
  reproduce     plausible and worth acting on, but nobody has confirmed it yet
  request_info  it cannot move until the reporter gives a version, a repro or a stack trace
  close         nothing should happen: obsolete, out of scope, duplicate, or long dead
  decide        it needs a maintainer's call on direction before any work makes sense
  wait          it is real but blocked on something outside the repository

area — what kind of work the issue is about: a bug, a feature request, a question, and so on. It
is the same judgment a pull request's area is, asked of something nobody has changed yet, so a
reported bug is "bug" where the pull request fixing it would be "bug fix". Question and discussion
are the answers that mean no change is being asked for at all.

relevance — whether it is still real. You are reading text alone, so say so honestly: an issue
naming a version several releases old, with no confirmation from anyone but its reporter and no
activity for a year, is likely obsolete. When the text does not settle it, answer unclear rather
than guessing. A thorough triage is what resolves these.

status — where it is stuck, which is often not the same as what to do about it.

effort — for an issue this is the scope of the change being asked for, not the work of implementing
it, which you cannot see from here. "Accept a className prop" is XS whatever the codebase looks
like; "rewrite the layout engine" is XL. Judge the size of the ask.

priority — urgency and importance together, on the issue's own terms. A question from a confused
user can be low priority and take a minute; a data-loss bug nobody has confirmed is still critical.

confidence — how much of this you are sure of. Text-only judgments of relevance and effort are
estimates, and a low confidence is more useful than a confident guess.

possible_duplicate_of — numbers from the index of open issues that look like the same report. It is
a candidate for the maintainer to confirm, not a finding: leave it empty unless the titles really
do describe one problem. Never list the issue's own number.

Fill it whenever you see a likely duplicate, whatever the next action is: a duplicate of something
already being worked on may still be worth answering rather than closing. Reach for
close_duplicate only when the other issue plainly covers this one, and put the number in
possible_duplicate_of when you do — the maintainer needs somewhere to send the reporter, and an
action that says "duplicate" without saying of what is worse than no action at all.

Closing a duplicate costs the maintainer a comment and a click, so it is offered first among the
things they can act on. Say so in confidence: an unsure duplicate is worse than a missed one,
because it sends someone away from a real report.
`;

const QUICK = `
You are triaging issues from their text: the title, the body, and up to ten of their comments. You
have no checkout and no code. Do not pretend to knowledge you do not have — the judgments that
depend on the code are relevance and effort, and both have an honest answer when the text is thin.

You may run \`gh\` to read what you were not given. The comment block says how many comments exist
and how many you were handed; when the ones you have do not explain where the issue stands, fetch
the rest. Do so sparingly: most issues need no call at all.
`;

const THOROUGH = `
You are triaging one issue in depth, in a checkout of the default branch, and you may build and run
things inside it. This is where relevance stops being a guess: find where in the code the report
lands, and try to reproduce it. Say what you did and what happened.
`;

const ANALYSIS = `
Write \`analysis\` as Markdown, with \`##\` sections Background, Intuition and Walkthrough, and
Mermaid fences where a picture shows the mechanism better than prose. It explains the part of the
system the issue touches and what fixing it would involve. It never judges: risks and
recommendations belong to the verdict's reasons.
`;

const SUBAGENTS = `
You were handed several issues. Judge each one on its own; they are unrelated. You may spread them
across subagents if that suits you. Reply with one entry per issue, naming its number.
`;

export function triageInstructions(
	depth: AssessmentDepth,
	options: {
		count: number;
		hasWorkingCopy?: boolean | undefined;
		timeoutMinutes?: number | undefined;
	},
): string {
	const parts = [
		"You are auditing the open issues of a GitHub repository for the maintainer who runs it.",
		READ_ONLY_INSTRUCTION,
		depth === "thorough" ? THOROUGH : QUICK,
		CRITERIA,
	];
	if (depth === "thorough") {
		parts.push(ANALYSIS);
		if (options.hasWorkingCopy === false) {
			parts.push(
				"There is no local clone, so you have no code to read. Judge from the text alone.",
			);
		}
	}
	if (options.count > 1) {
		parts.push(SUBAGENTS);
	}
	if (options.timeoutMinutes !== undefined) {
		parts.push(`You have about ${String(options.timeoutMinutes)} minutes.`);
	}
	return parts.map((part) => part.trim()).join("\n\n");
}

export function buildTriagePrompt(input: TriagePromptInput): string {
	const [first] = input.issues;
	if (!first) {
		throw new RangeError("A triage prompt needs at least one issue.");
	}

	const sections = [
		triageInstructions(input.depth, {
			count: input.issues.length,
			hasWorkingCopy: input.hasWorkingCopy,
			timeoutMinutes: input.timeoutMinutes,
		}),
		section("repository", [`name: ${input.repository}`]),
	];

	if (input.repositoryContext?.trim()) {
		sections.push(section("repository-context", [input.repositoryContext.trim()]));
	}
	if (input.depth === "thorough" && input.thoroughInstructions?.trim()) {
		sections.push(section("thorough-instructions", [input.thoroughInstructions.trim()]));
	}

	const index = input.duplicateIndex ?? [];
	if (index.length > 0) {
		const shown = index.slice(0, DUPLICATE_INDEX_LIMIT);
		sections.push(
			section("open-issues", [
				"Every open issue of this repository, most recently updated first. Titles only: use it to",
				"propose duplicates, and treat a match as a candidate rather than a finding.",
				...(shown.length < index.length
					? [`(${String(index.length - shown.length)} older ones are not listed.)`]
					: []),
				"",
				...shown.map((entry) => `#${String(entry.number)} ${entry.title}`),
			]),
		);
	}

	sections.push(...input.issues.map(issueBlock));

	return sections.join("\n\n");
}

function issueBlock(item: TriagePromptIssue): string {
	const { bundle } = item;
	const parts = [
		section("facts", factLines(item)),
		section("body", [bundle.body.trim() || "(empty)"]),
		section("comments", commentLines(bundle)),
	];

	const previous = (item.previousAssessments ?? []).slice(0, PREVIOUS_ASSESSMENT_COUNT);
	if (previous.length > 0) {
		parts.push(section("previous-assessments", previous.flatMap(previousLines)));
	}

	return `<issue number="${String(bundle.facts.number)}">\n${parts.join("\n\n")}\n</issue>`;
}

function factLines(item: TriagePromptIssue): string[] {
	const { facts } = item.bundle;
	return [
		`number: ${String(facts.number)}`,
		`title: ${facts.title}`,
		`url: ${facts.url}`,
		`author: ${facts.author}${facts.isBot ? " (bot)" : ""}`,
		`author's association with the repository: ${facts.authorAssociation}`,
		`opened by the maintainer running this audit: ${yesNo(facts.authoredByUser)}`,
		`created: ${facts.createdAt}`,
		`last change that could matter: ${facts.changedAt}`,
		`last activity: ${facts.lastActivityAt} by ${facts.lastActivityBy ?? "unknown"}`,
		`labels: ${facts.labels.join(", ") || "none"}`,
		`assignees: ${facts.assignees.join(", ") || "none"}`,
		`milestone: ${facts.milestone ?? "none"}`,
		`linked pull requests: ${
			facts.linkedPullRequests.map((number) => `#${String(number)}`).join(", ") || "none"
		}`,
	];
}

function commentLines(bundle: IssueBundle): string[] {
	if (bundle.commentsTotal === 0) {
		return ["(none)"];
	}
	const header =
		bundle.comments.length < bundle.commentsTotal
			? [
					`${String(bundle.commentsTotal)} comments in all; the first few and the last few are`,
					"below. Fetch the rest with `gh` if these do not explain where the issue stands.",
					"",
				]
			: [];
	return [
		...header,
		...bundle.comments.flatMap((comment) => [
			`--- ${comment.author}${comment.isBot ? " (bot)" : ""} (${comment.authorAssociation}) at ${
				comment.createdAt
			}`,
			comment.body.trim() || "(empty)",
		]),
	];
}

function previousLines(assessment: Assessment): string[] {
	const { verdict } = assessment;
	if (!verdict) {
		return [`${assessment.createdAt}: no verdict (${assessment.error ?? "unknown reason"})`];
	}
	return [
		`${assessment.createdAt}: ${verdict.nextAction}, ${verdict.priority ?? "no priority"}, effort ${
			verdict.effort
		}`,
		`  ${verdict.summary}`,
	];
}

function section(name: string, lines: string[]): string {
	return `<${name}>\n${lines.join("\n")}\n</${name}>`;
}

function yesNo(value: boolean): string {
	return value ? "yes" : "no";
}
