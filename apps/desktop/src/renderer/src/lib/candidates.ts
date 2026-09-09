import type { OutdatedReason, RefreshCandidate } from "../../../shared/ipc.js";

export const REASONS = ["never", "changed", "failed", "aged"] as const;

export const REASON_LABELS: Record<OutdatedReason, string> = {
	never: "Never assessed",
	changed: "Changed since the last assessment",
	failed: "The last assessment failed",
	aged: "Assessment older than the cut-off",
};

export interface CandidateChoices {
	reasons: Record<OutdatedReason, boolean>;
	skipBots: boolean;
	skipDrafts: boolean;
	/** Keep only this many, most recently active first. Null keeps all of them. */
	limit: number | null;
}

export const ALL_REASONS: Record<OutdatedReason, boolean> = {
	never: true,
	changed: true,
	failed: true,
	aged: true,
};

export function defaultChoices(): CandidateChoices {
	return { reasons: { ...ALL_REASONS }, skipBots: false, skipDrafts: false, limit: null };
}

/** How many candidates fall into each reason, for the counts beside the checkboxes. */
export function countByReason(candidates: RefreshCandidate[]): Record<OutdatedReason, number> {
	const counts: Record<OutdatedReason, number> = { never: 0, changed: 0, failed: 0, aged: 0 };
	for (const candidate of candidates) {
		counts[candidate.reason] += 1;
	}
	return counts;
}

export function countBots(candidates: RefreshCandidate[]): number {
	return candidates.filter((candidate) => candidate.isBot).length;
}

export function countDrafts(candidates: RefreshCandidate[]): number {
	return candidates.filter((candidate) => candidate.isDraft).length;
}

/**
 * Narrows the candidates down to what the user asked for. The limit applies last and keeps the most
 * recently active, which is the half of a long backlog worth spending on first.
 */
export function selectCandidates(
	candidates: RefreshCandidate[],
	choices: CandidateChoices,
): RefreshCandidate[] {
	const kept = candidates.filter(
		(candidate) =>
			choices.reasons[candidate.reason] &&
			!(choices.skipBots && candidate.isBot) &&
			!(choices.skipDrafts && candidate.isDraft),
	);

	if (choices.limit === null || kept.length <= choices.limit) {
		return kept;
	}

	return kept
		.toSorted((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))
		.slice(0, Math.max(choices.limit, 0));
}
