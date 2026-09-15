import { useCallback, useMemo, useState } from "react";
import type { ItemKind } from "@proctologist/core/browser";
import { DEFAULT_COLUMNS, isColumnKey, type ColumnKey } from "../lib/columns.js";

/**
 * Per kind, because the two do not have the same columns: hiding Replies on issues should not take
 * a column from pull requests, which have no such column to take.
 */
const storageKey = (kind: ItemKind): string => `proctologist:columns:${kind}`;

/** Which columns the table shows, remembered across launches like the panel's width is. */
export function useColumns(
	kind: ItemKind,
): [readonly ColumnKey[], (columns: readonly ColumnKey[]) => void] {
	const [byKind, setByKind] = useState<Partial<Record<ItemKind, readonly ColumnKey[]>>>({});
	// Read once per kind rather than on every render: `read` parses JSON, so calling it in the body
	// would hand back a new array each time and rebuild everything memoised on it.
	const stored = useMemo(() => read(kind), [kind]);
	const columns = byKind[kind] ?? stored;

	const change = useCallback(
		(next: readonly ColumnKey[]): void => {
			setByKind((current) => ({ ...current, [kind]: next }));
			globalThis.localStorage.setItem(storageKey(kind), JSON.stringify(next));
		},
		[kind],
	);

	return [columns, change];
}

function read(kind: ItemKind): readonly ColumnKey[] {
	const stored = globalThis.localStorage.getItem(storageKey(kind));
	if (stored === null) {
		return DEFAULT_COLUMNS;
	}
	try {
		const parsed: unknown = JSON.parse(stored);
		// A column that no longer exists is dropped rather than kept as a ghost in the choice.
		return Array.isArray(parsed) ? parsed.filter(isColumnKey) : DEFAULT_COLUMNS;
	} catch {
		return DEFAULT_COLUMNS;
	}
}
