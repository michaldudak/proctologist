import { Badge, Button } from "@cloudflare/kumo";
import { MicroscopeIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { AGENT_LABELS, type Analysis } from "@proctologist/core/browser";
import { leadOf } from "../lib/markdown.js";
import { absoluteDate } from "../lib/format.js";
import { ReaderDialog } from "./ReaderDialog.js";

interface AnalysisSectionProps {
	analysis: Analysis;
	/** The pull request as it stands now, so an analysis of an older head can say so. */
	item: { number: number; title: string; headSha: string };
	onCopy: (text: string) => void;
	onOpenLink: (url: string) => void;
}

/**
 * The taste of the analysis in the side panel: its first paragraph, cut short, with when it was
 * written and whether the pull request has moved on since. The panel is too narrow for the pages
 * of prose and diagrams behind it, which open in a reader of their own.
 */
export function AnalysisSection({
	analysis,
	item,
	onCopy,
	onOpenLink,
}: AnalysisSectionProps): React.JSX.Element {
	const [open, setOpen] = useState(false);
	const outdated = analysis.headSha !== item.headSha;
	const lead = leadOf(analysis.markdown);
	const written = `Written ${absoluteDate(analysis.createdAt)}${
		analysis.agent ? ` by ${AGENT_LABELS[analysis.agent]}` : ""
	}`;
	const stale = outdated ? <Badge variant="warning">Describes an older version</Badge> : null;

	return (
		<article className="write-up">
			<div className="write-up-head">
				<MicroscopeIcon size={15} aria-hidden />
				<h4>Analysis</h4>
				{stale}
			</div>

			{lead ? <p className="write-up-lead">{lead}</p> : null}

			<div className="write-up-foot">
				<span className="header-meta">{written}</span>
				<Button size="xs" variant="secondary" onClick={() => setOpen(true)}>
					Read
				</Button>
			</div>

			{open ? (
				<ReaderDialog
					label="Analysis"
					item={item}
					markdown={analysis.markdown}
					meta={
						<>
							<span className="header-meta">
								{written}
								{analysis.model ? ` (${analysis.model})` : ""}
							</span>
							{stale}
						</>
					}
					onCopy={onCopy}
					onOpenLink={onOpenLink}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</article>
	);
}
