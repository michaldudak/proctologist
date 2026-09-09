import type { PullRequestRow } from "../../../shared/ipc.js";
import { verdictFieldLabel } from "../lib/format.js";

interface Marker {
	key: string;
	glyph: string;
	title: string;
	tone?: "accent" | "warn";
}

/**
 * Small square glyphs beside the title. They are deliberately terse: at a hundred rows the eye
 * scans shapes, and the title tooltip carries the words.
 */
export function markersFor(row: PullRequestRow): Marker[] {
	const markers: Marker[] = [];

	if (row.pullRequest.authoredByUser) {
		markers.push({ key: "mine", glyph: "You", title: "You opened this", tone: "accent" });
	}
	if (row.pullRequest.reviewRequestedFromUser) {
		markers.push({ key: "review", glyph: "R", title: "Review requested from you", tone: "accent" });
	}
	if (row.pullRequest.isDraft) {
		markers.push({ key: "draft", glyph: "D", title: "Draft" });
	}
	if (row.pullRequest.isBot) {
		markers.push({ key: "bot", glyph: "B", title: "Opened by a bot" });
	}
	if (row.note !== null) {
		markers.push({ key: "note", glyph: "N", title: "You left a note" });
	}
	if (row.derived.changed.length > 0) {
		markers.push({
			key: "changed",
			glyph: "●",
			title: `Changed since the previous assessment: ${row.derived.changed
				.map(verdictFieldLabel)
				.join(", ")}`,
			tone: "warn",
		});
	}
	if (row.derived.snoozed) {
		markers.push({ key: "snoozed", glyph: "Z", title: "Snoozed" });
	}

	return markers;
}

export function Markers({ row }: { row: PullRequestRow }): React.JSX.Element | null {
	const markers = markersFor(row);
	if (markers.length === 0) {
		return null;
	}

	return (
		<span className="markers">
			{markers.map((marker) => (
				<span key={marker.key} className="marker" data-tone={marker.tone} title={marker.title}>
					{marker.glyph}
					<span className="visually-hidden">{marker.title}</span>
				</span>
			))}
		</span>
	);
}
