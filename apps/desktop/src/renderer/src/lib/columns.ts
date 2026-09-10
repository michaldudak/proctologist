import type { SortKey } from "./filters.js";

export interface Column {
	key: Exclude<SortKey, "default">;
	label: string;
	width: string;
	/** Numbers read right, the glyph and badge columns read centred, and words are left alone. */
	align?: "right" | "center";
	/** Dropped when the side panel is open, which shows the same thing in more detail. */
	secondary?: boolean;
	/** Always shown: the table would not identify its rows without it. */
	fixed?: boolean;
	/** Left out until the user asks for it. */
	hiddenByDefault?: boolean;
}

export type ColumnKey = Column["key"];

export const COLUMNS: readonly Column[] = [
	{ key: "number", label: "#", width: "4rem", align: "right", fixed: true },
	{ key: "title", label: "Title", width: "auto", fixed: true },
	{ key: "author", label: "Author", width: "8rem", secondary: true },
	{ key: "nextAction", label: "Next action", width: "8.5rem" },
	{ key: "priority", label: "Priority", width: "5.5rem", align: "center" },
	{ key: "area", label: "Area", width: "6rem", align: "center", secondary: true },
	{ key: "relevance", label: "Relevance", width: "6.25rem", align: "center", secondary: true },
	// Status says whose court the ball is in, which the next action already implies nearly every
	// time, so it stays available for the curious rather than taking a column from everyone.
	{ key: "status", label: "Status", width: "9.5rem", secondary: true, hiddenByDefault: true },
	{ key: "effort", label: "Effort", width: "4.5rem", align: "center" },
	{ key: "age", label: "Age", width: "3.5rem", align: "right" },
	{ key: "lastActivity", label: "Activity", width: "4.5rem", align: "right" },
];

/** Every column not hidden by default, until the user says otherwise. */
export const DEFAULT_COLUMNS: readonly ColumnKey[] = COLUMNS.filter(
	(column) => column.hiddenByDefault !== true,
).map((column) => column.key);

export function isColumnKey(value: unknown): value is ColumnKey {
	return COLUMNS.some((column) => column.key === value);
}

/** The columns to draw, in the table's own order, whatever order the choice was made in. */
export function visibleColumns(chosen: readonly ColumnKey[], compact: boolean): Column[] {
	return COLUMNS.filter(
		(column) =>
			(column.fixed === true || chosen.includes(column.key)) && !(compact && column.secondary),
	);
}

export function toggleColumn(chosen: readonly ColumnKey[], key: ColumnKey): ColumnKey[] {
	return chosen.includes(key) ? chosen.filter((item) => item !== key) : [...chosen, key];
}
