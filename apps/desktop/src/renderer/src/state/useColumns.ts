import { useCallback, useState } from "react";
import { DEFAULT_COLUMNS, isColumnKey, type ColumnKey } from "../lib/columns.js";

const STORAGE_KEY = "proctologist:columns";

/** Which columns the table shows, remembered across launches like the panel's width is. */
export function useColumns(): [readonly ColumnKey[], (columns: readonly ColumnKey[]) => void] {
	const [columns, setColumns] = useState(read);

	const change = useCallback((next: readonly ColumnKey[]): void => {
		setColumns(next);
		globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
	}, []);

	return [columns, change];
}

function read(): readonly ColumnKey[] {
	const stored = globalThis.localStorage.getItem(STORAGE_KEY);
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
