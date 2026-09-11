import { Badge, Button } from "@cloudflare/kumo";
import { useState } from "react";
import { REVIEW_VERDICTS, SEVERITIES, type Severity } from "@proctologist/core/browser";
import type { ReviewDraft } from "../../../shared/ipc.js";
import { absoluteDate } from "../lib/format.js";

interface ReviewDraftSectionProps {
	draft: ReviewDraft;
	markdown: string;
	onCopy: (text: string) => void;
	onOpenOnGitHub: (url: string) => void;
	itemUrl: string;
}

const SEVERITY_VARIANTS: Record<Severity, "red" | "orange" | "neutral" | "blue"> = {
	blocker: "red",
	major: "orange",
	minor: "neutral",
	nit: "neutral",
	question: "blue",
};

export function ReviewDraftSection({
	draft,
	markdown,
	onCopy,
	onOpenOnGitHub,
	itemUrl,
}: ReviewDraftSectionProps): React.JSX.Element {
	const [copied, setCopied] = useState(false);

	return (
		<section className="panel-section">
			<div className="panel-row">
				<h3>Review draft</h3>
				<span className="header-spacer" />
				<Button
					size="xs"
					variant="ghost"
					onClick={() => {
						onCopy(markdown);
						setCopied(true);
					}}
				>
					{copied ? "Copied" : "Copy as markdown"}
				</Button>
				<Button size="xs" variant="ghost" onClick={() => onOpenOnGitHub(itemUrl)}>
					Post it yourself
				</Button>
			</div>

			<div className="panel-row">
				<Badge variant={draft.verdict === "approve" ? "green" : "orange"}>
					{REVIEW_VERDICTS[draft.verdict as keyof typeof REVIEW_VERDICTS] ?? draft.verdict}
				</Badge>
				<span className="header-meta">{absoluteDate(draft.createdAt)}</span>
			</div>

			<p>{draft.summary}</p>

			{draft.findings.length === 0 ? (
				<span className="header-meta">Nothing to raise.</span>
			) : (
				<ul className="panel-evidence">
					{draft.findings.map((finding) => (
						<li key={`${finding.title}:${finding.path ?? ""}`}>
							<span className="panel-row">
								<Badge variant={SEVERITY_VARIANTS[finding.severity as Severity] ?? "neutral"}>
									{SEVERITIES[finding.severity as Severity] ?? finding.severity}
								</Badge>
								<strong>{finding.title}</strong>
							</span>
							{finding.path ? (
								<code className="finding-location">
									{finding.path}
									{finding.line === undefined ? "" : `:${String(finding.line)}`}
								</code>
							) : null}
							<div>{finding.body}</div>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
