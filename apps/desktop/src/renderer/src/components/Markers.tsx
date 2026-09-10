import {
	BellZIcon,
	CircleNotchIcon,
	EyeIcon,
	FileDashedIcon,
	HourglassIcon,
	NoteIcon,
	RobotIcon,
	UserIcon,
	type Icon,
} from "@phosphor-icons/react";
import type { PullRequestRow } from "../../../shared/ipc.js";
import { Glyph, type GlyphTone } from "./Glyph.js";

interface Marker {
	key: string;
	icon: Icon;
	label: string;
	tone?: GlyphTone;
	/** The icon turns, for the one marker that means something is happening right now. */
	spinning?: boolean;
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
	if (row.derived.snoozed) {
		markers.push({ key: "snoozed", icon: BellZIcon, label: "Snoozed" });
	}
	// Last, as the newest thing about the row: the agent has it in hand, or will shortly.
	if (row.assessing === "running") {
		markers.push({
			key: "assessing",
			icon: CircleNotchIcon,
			label: "Being assessed",
			tone: "accent",
			spinning: true,
		});
	} else if (row.assessing === "queued") {
		markers.push({ key: "awaiting", icon: HourglassIcon, label: "Awaiting assessment" });
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
					spinning={marker.spinning}
				/>
			))}
		</span>
	);
}
