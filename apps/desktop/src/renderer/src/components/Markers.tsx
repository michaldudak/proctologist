import {
	ArrowsClockwiseIcon,
	BellZIcon,
	EyeIcon,
	FileDashedIcon,
	NoteIcon,
	RobotIcon,
	UserIcon,
	type Icon,
} from "@phosphor-icons/react";
import type { PullRequestRow } from "../../../shared/ipc.js";
import { verdictFieldLabel } from "../lib/format.js";
import { Glyph, type GlyphTone } from "./Glyph.js";

interface Marker {
	key: string;
	icon: Icon;
	label: string;
	tone?: GlyphTone;
}

/** The facts about a pull request that are worth seeing before its title, in reading order. */
export function markersFor(row: PullRequestRow): Marker[] {
	const markers: Marker[] = [];

	if (row.pullRequest.authoredByUser) {
		markers.push({ key: "mine", icon: UserIcon, label: "You opened this", tone: "accent" });
	}
	if (row.pullRequest.reviewRequestedFromUser) {
		markers.push({
			key: "review",
			icon: EyeIcon,
			label: "Review requested from you",
			tone: "accent",
		});
	}
	if (row.pullRequest.isDraft) {
		markers.push({ key: "draft", icon: FileDashedIcon, label: "Draft" });
	}
	if (row.pullRequest.isBot) {
		markers.push({ key: "bot", icon: RobotIcon, label: "Opened by a bot" });
	}
	if (row.note !== null) {
		markers.push({ key: "note", icon: NoteIcon, label: "You left a note" });
	}
	if (row.derived.changed.length > 0) {
		markers.push({
			key: "changed",
			icon: ArrowsClockwiseIcon,
			label: `Changed since the previous assessment: ${row.derived.changed
				.map(verdictFieldLabel)
				.join(", ")}`,
			tone: "warn",
		});
	}
	if (row.derived.snoozed) {
		markers.push({ key: "snoozed", icon: BellZIcon, label: "Snoozed" });
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
				<Glyph
					key={marker.key}
					icon={marker.icon}
					label={marker.label}
					shape="chip"
					tone={marker.tone}
				/>
			))}
		</span>
	);
}
