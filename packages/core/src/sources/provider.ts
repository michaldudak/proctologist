import type { ItemState, Source } from "./types.js";
export interface ExternalItemRef {
	kind: string;
	externalId: string;
}
export interface SourceReadOptions {
	signal?: AbortSignal;
	diffCutoffKb?: number;
}
/** A successful list is a complete snapshot of the requested kinds, never a partial page. */
export interface SourceProvider<Facts, Context> {
	listOpen: (source: Source, kinds: string[], options?: SourceReadOptions) => Promise<Facts[]>;
	readState: (
		source: Source,
		ref: ExternalItemRef,
		options?: SourceReadOptions,
	) => Promise<ItemState>;
	context: (source: Source, ref: ExternalItemRef, options?: SourceReadOptions) => Promise<Context>;
}
