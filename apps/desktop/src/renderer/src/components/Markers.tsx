import {
	BellZIcon,
	CheckCircleIcon,
	CircleNotchIcon,
	EyeIcon,
	FileDashedIcon,
	HourglassIcon,
	MicroscopeIcon,
	NoteIcon,
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

/**
 * The facts about a pull request that are worth seeing before its title, in reading order. Who
 * opened it is not among them: that mark stands beside the author's login instead.
 */
export function markersFor(row: PullRequestRow): Marker[] {
	const markers: Marker[] = [];

	if (row.pullRequest.reviewRequestedFromUser) {
		markers.push({
			key: "review",
			icon: EyeIcon,
			label: "Review requested from you",
			tone: "success",
		});
	}
	if (row.pullRequest.isDraft) {
		markers.push({ key: "draft", icon: FileDashedIcon, label: "Draft" });
	}
	if (row.note !== null) {
		markers.push({ key: "note", icon: NoteIcon, label: "You left a note", tone: "yellow" });
	}
	if (row.hasAnalysis) {
		markers.push({
			key: "analysis",
			icon: MicroscopeIcon,
			label: "Assessed thoroughly",
			tone: "purple",
		});
	}
	if (row.derived.viewed) {
		markers.push({ key: "viewed", icon: CheckCircleIcon, label: "Viewed" });
	}
	if (row.derived.snoozed) {
		markers.push({ key: "snoozed", icon: BellZIcon, label: "Snoozed" });
	}
	// Last, as the newest thing about the row: the agent has it in hand, or will shortly.
	if (row.activity?.state === "running") {
		markers.push({
			key: "working",
			icon: CircleNotchIcon,
			label: row.activity.kind === "review_draft" ? "Review being drafted" : "Being assessed",
			tone: "accent",
			spinning: true,
		});
	} else if (row.activity?.state === "queued") {
		markers.push({
			key: "awaiting",
			icon: HourglassIcon,
			label:
				row.activity.kind === "review_draft" ? "Awaiting a review draft" : "Awaiting assessment",
		});
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
