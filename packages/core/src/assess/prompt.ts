import type { PullRequestBundle } from "../github/client.js";
import type { Assessment, AssessmentDepth } from "../store/types.js";
import { assessmentInstructions } from "./prompt-text.js";

/**
 * Everything the assessment prompt is built from. Notes are deliberately absent: they are private
 * to the user and never reach Codex (ADR 0005).
 */
export interface AssessmentPromptInput {
	depth: AssessmentDepth;
	bundle: PullRequestBundle;
	defaultBranch: string;
	/** The repository's free-text `context` from the config file, if it has one. */
	repositoryContext?: string | undefined;
	/** The two most recent assessments, newest first. Reduced to verdicts, reasons and summary. */
	previousAssessments?: Assessment[] | undefined;
	/** False when no local clone is configured and Codex has no code to read. */
	hasWorkingCopy?: boolean | undefined;
}

const PREVIOUS_ASSESSMENT_COUNT = 2;

export function buildAssessmentPrompt(input: AssessmentPromptInput): string {
	const { bundle } = input;
	const sections = [
		assessmentInstructions(input.depth, { hasWorkingCopy: input.hasWorkingCopy }),
		section("repository", [
			`name: ${bundle.facts.repository}`,
			`default branch: ${input.defaultBranch}`,
		]),
	];

	if (input.repositoryContext?.trim()) {
		sections.push(section("repository-context", [input.repositoryContext.trim()]));
	}

	sections.push(
		section("pull-request", factLines(input)),
		section("body", [bundle.body.trim() || "(empty)"]),
		section("comments", messageLines(bundle.comments)),
		section("reviews", reviewLines(bundle)),
		section("review-threads", threadLines(bundle)),
		section("files", fileLines(bundle)),
		section("diff", [bundle.diff ?? `(omitted) ${bundle.diffOmittedReason ?? ""}`.trim()]),
	);

	const previous = (input.previousAssessments ?? []).slice(0, PREVIOUS_ASSESSMENT_COUNT);
	if (previous.length > 0) {
		sections.push(section("previous-assessments", previous.flatMap(previousLines)));
	}

	return sections.join("\n\n");
}

/** Appends the validation errors to a prompt so the retry knows what was wrong the first time. */
export function buildRetryPrompt(prompt: string, issues: string[]): string {
	return `${prompt}

${section("previous-attempt-rejected", [
	"Your last reply did not match the output schema:",
	...issues.map((issue) => `- ${issue}`),
	"Reply again with a valid JSON object and nothing else.",
])}`;
}

function factLines(input: AssessmentPromptInput): string[] {
	const { facts } = input.bundle;
	return [
		`number: ${String(facts.number)}`,
		`title: ${facts.title}`,
		`url: ${facts.url}`,
		`author: ${facts.author}${facts.isBot ? " (bot)" : ""}`,
		`authored by the maintainer running this audit: ${yesNo(facts.authoredByUser)}`,
		`review requested from the maintainer: ${yesNo(facts.reviewRequestedFromUser)}`,
		`draft: ${yesNo(facts.isDraft)}`,
		`created: ${facts.createdAt}`,
		`updated: ${facts.updatedAt}`,
		`last activity: ${facts.lastActivityAt} by ${facts.lastActivityBy ?? "unknown"}`,
		`base branch: ${facts.baseRef}`,
		`head commit: ${facts.headSha}`,
		`labels: ${facts.labels.join(", ") || "none"}`,
		`diff size: +${String(facts.additions)} -${String(facts.deletions)} across ${String(
			facts.changedFiles,
		)} files`,
		`mergeable: ${facts.mergeable ?? "unknown"}`,
		`review decision: ${facts.reviewDecision ?? "none"}`,
		`checks: ${facts.checks.state} (${String(facts.checks.passed)} passed, ${String(
			facts.checks.failed,
		)} failed, ${String(facts.checks.pending)} pending)`,
	];
}

function messageLines(comments: PullRequestBundle["comments"]): string[] {
	if (comments.length === 0) {
		return ["(none)"];
	}
	return comments.map(
		(comment) => `${comment.author ?? "unknown"} on ${comment.createdAt}:\n${comment.body.trim()}`,
	);
}

function reviewLines(bundle: PullRequestBundle): string[] {
	if (bundle.reviews.length === 0) {
		return ["(none)"];
	}
	return bundle.reviews.map((review) =>
		[
			`${review.author ?? "unknown"} ${review.state} on ${review.submittedAt ?? "unknown date"}`,
			review.body.trim(),
		]
			.filter((part) => part !== "")
			.join("\n"),
	);
}

function threadLines(bundle: PullRequestBundle): string[] {
	if (bundle.reviewThreads.length === 0) {
		return ["(none)"];
	}
	return bundle.reviewThreads.map((thread) => {
		const state = [thread.isResolved ? "resolved" : "unresolved", thread.isOutdated && "outdated"]
			.filter(Boolean)
			.join(", ");
		const comments = thread.comments.map(
			(comment) => `  ${comment.author ?? "unknown"}: ${comment.body.trim()}`,
		);
		return [`${thread.path ?? "(no file)"} [${state}]`, ...comments].join("\n");
	});
}

function fileLines(bundle: PullRequestBundle): string[] {
	if (bundle.files.length === 0) {
		return ["(none)"];
	}
	const lines = bundle.files.map(
		(file) => `${file.path} +${String(file.additions)} -${String(file.deletions)}`,
	);
	if (bundle.filesTruncated) {
		lines.push("(the list is cut off; the pull request touches more files than this)");
	}
	return lines;
}

function previousLines(assessment: Assessment): string[] {
	const when = `${assessment.createdAt} (${assessment.depth}, head ${assessment.headSha.slice(0, 12)})`;
	if (!assessment.verdict) {
		return [`${when}: no assessment — ${assessment.error ?? "unknown error"}`];
	}
	const verdict = assessment.verdict;
	return [
		[
			when,
			`  next action: ${verdict.nextAction} — ${verdict.nextActionReason}`,
			`  category: ${verdict.category}`,
			`  relevance: ${verdict.relevance} — ${verdict.relevanceReason}`,
			`  status: ${verdict.status} — ${verdict.statusReason}`,
			`  effort: ${verdict.effort} — ${verdict.effortReason}`,
			`  summary: ${verdict.summary}`,
		].join("\n"),
	];
}

function section(name: string, lines: string[]): string {
	return `<${name}>\n${lines.join("\n")}\n</${name}>`;
}

function yesNo(value: boolean): string {
	return value ? "yes" : "no";
}
