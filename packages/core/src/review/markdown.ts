import type { ReviewDraft } from "../store/types.js";
import { REVIEW_VERDICTS, SEVERITIES, SEVERITY_ORDER, type Severity } from "./schema.js";

/** Renders a draft as markdown, ready to paste into GitHub's review box. */
export function toMarkdown(draft: ReviewDraft): string {
	const verdict = REVIEW_VERDICTS[draft.verdict as keyof typeof REVIEW_VERDICTS] ?? draft.verdict;
	const lines = [`**${verdict}** — ${draft.summary.trim()}`];

	const bySeverity = new Map<string, typeof draft.findings>();
	for (const finding of draft.findings) {
		const key = finding.severity ?? "question";
		bySeverity.set(key, [...(bySeverity.get(key) ?? []), finding]);
	}

	const order = [
		...SEVERITY_ORDER,
		...[...bySeverity.keys()].filter((key) => !SEVERITY_ORDER.includes(key as Severity)),
	];

	for (const severity of order) {
		const findings = bySeverity.get(severity);
		if (!findings || findings.length === 0) {
			continue;
		}
		lines.push("", `### ${SEVERITIES[severity as Severity] ?? severity}`);
		for (const finding of findings) {
			const where = finding.path
				? ` — \`${finding.path}${finding.line ? `:${String(finding.line)}` : ""}\``
				: "";
			lines.push("", `- **${finding.title}**${where}`, `  ${finding.body.trim()}`);
		}
	}

	return `${lines.join("\n")}\n`;
}
