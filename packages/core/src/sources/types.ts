/** A configured collection; its locator belongs to its provider. */
export interface Source {
	id: string;
	provider: string;
	locator: string;
	active: boolean;
}
export type SourceState = "open" | "closed" | "unknown";
export type ClosureOutcome = "successful" | "other" | "unknown";
export interface SourceItem {
	id: string;
	sourceId: string;
	provider: string;
	locator: string;
	kind: string;
	externalId: string;
	title: string;
	url: string;
	state: SourceState;
	outcome: ClosureOutcome;
	available: boolean;
	verifiedAt: string | null;
	reopenedAt: string | null;
}
export interface ItemState {
	state: "open" | "closed";
	outcome: ClosureOutcome;
	title?: string;
	url?: string;
}
