import { Badge, Button } from "@cloudflare/kumo";
import { useState } from "react";
import { AGENT_LABELS, type Analysis } from "@proctologist/core/browser";
import { leadOf } from "../lib/markdown.js";
import { absoluteDate } from "../lib/format.js";
import { AnalysisDialog } from "./AnalysisDialog.js";
import { Tooltip } from "./Tooltip.js";

interface AnalysisSectionProps {
	analysis: Analysis;
	/** The pull request as it stands now, so an analysis of an older head can say so. */
	item: { number: number; title: string; headSha: string };
	onCopy: (text: string) => void;
	onOpenLink: (url: string) => void;
}

/**
 * The taste of the analysis in the side panel: when it was written, whether the pull request has
 * moved on since, and its first paragraph. The panel is too narrow for the pages of prose and
 * diagrams behind it, which open in a reader of their own.
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

	return (
		<section className="panel-section">
			<div className="panel-row">
				<h3>Analysis</h3>
				<span className="header-spacer" />
				<Button size="xs" variant="primary" onClick={() => setOpen(true)}>
					Read
				</Button>
			</div>

			<div className="panel-row">
				<Tooltip
					content={absoluteDate(analysis.createdAt)}
					render={<span className="header-meta" />}
				>
					Written {absoluteDate(analysis.createdAt)}
					{analysis.agent ? ` by ${AGENT_LABELS[analysis.agent]}` : ""}
				</Tooltip>
				{outdated ? <Badge variant="warning">Describes an older version</Badge> : null}
			</div>

			{lead ? <p className="analysis-lead">{lead}</p> : null}

			{open ? (
				<AnalysisDialog
					analysis={analysis}
					item={item}
					outdated={outdated}
					onCopy={onCopy}
					onOpenLink={onOpenLink}
					onClose={() => setOpen(false)}
				/>
			) : null}
		</section>
	);
}
