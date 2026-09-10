import { useStableCallback } from "@base-ui/utils/useStableCallback";
import { memo, useEffect, useRef } from "react";
import type { PullRequestRow } from "../../../shared/ipc.js";
import type { SortKey } from "../lib/filters.js";
import { shortDuration } from "../lib/format.js";
import type { PullRequestListStore } from "../state/PullRequestListStore.js";
import { EffortBadge } from "./EffortBadge.js";
import { Markers } from "./Markers.js";
import { Tooltip } from "./Tooltip.js";
import { NextAction } from "./NextAction.js";
import { AreaGlyph, PriorityGlyph, RelevanceGlyph, StatusText } from "./VerdictGlyphs.js";

/** What stands in for the next action while there is none, and why. */
function unassessedLabel(row: PullRequestRow): string {
	switch (row.assessing) {
		case "running": {
			return "Assessing…";
		}
		case "queued": {
			return "Queued";
		}
		default: {
			return row.assessment?.error ? "Unassessed" : "Not assessed yet";
		}
	}
}

interface Column {
	key: SortKey;
	label: string;
	width: string;
	/** Numbers read right, the glyph and badge columns read centred, and words are left alone. */
	align?: "right" | "center";
	/** Dropped when the side panel is open, which shows the same thing in more detail. */
	secondary?: boolean;
}

const COLUMNS: Column[] = [
	{ key: "number", label: "#", width: "4rem", align: "right" },
	{ key: "title", label: "Title", width: "auto" },
	{ key: "author", label: "Author", width: "8rem", secondary: true },
	{ key: "nextAction", label: "Next action", width: "8.5rem" },
	{ key: "priority", label: "Priority", width: "5.5rem", align: "center" },
	{ key: "area", label: "Area", width: "6rem", align: "center", secondary: true },
	{ key: "relevance", label: "Relevance", width: "6.25rem", align: "center", secondary: true },
	{ key: "status", label: "Status", width: "9.5rem", secondary: true },
	{ key: "effort", label: "Effort", width: "4.5rem", align: "center" },
	{ key: "age", label: "Age", width: "3.5rem", align: "right" },
	{ key: "lastActivity", label: "Activity", width: "4.5rem", align: "right" },
];

interface PullRequestTableProps {
	store: PullRequestListStore;
	onOpen: (row: PullRequestRow) => void;
	/** True while the side panel takes half the window. */
	compact: boolean;
}

/**
 * The table subscribes to the order of the rows and nothing more; each row subscribes to itself.
 * An assessment landing on one pull request therefore redraws that row alone, and the rest of the
 * list sits still while the agent works through it.
 */
export function PullRequestTable({
	store,
	onOpen,
	compact,
}: PullRequestTableProps): React.JSX.Element {
	const numbers = store.useState("visibleNumbers");
	const sort = store.useState("sort");
	const columns = compact ? COLUMNS.filter((column) => !column.secondary) : COLUMNS;

	// Stable, so a row need not redraw because the app did. Both read the store at the moment of
	// the event rather than subscribing to it.
	const open = useStableCallback(onOpen);
	const onKeyDown = useStableCallback((event: React.KeyboardEvent): void => {
		switch (event.key) {
			case "ArrowDown":
			case "j": {
				event.preventDefault();
				store.moveSelection(1);
				break;
			}
			case "ArrowUp":
			case "k": {
				event.preventDefault();
				store.moveSelection(-1);
				break;
			}
			case "Enter": {
				const { selected } = store.state;
				const row = selected === null ? undefined : store.select("row", selected);
				if (row) {
					event.preventDefault();
					open(row);
				}
				break;
			}
			default: {
				break;
			}
		}
	});

	return (
		<div className="table-scroll">
			<table className="table">
				<colgroup>
					{columns.map((column) => (
						<col key={column.key} style={{ width: column.width }} />
					))}
				</colgroup>
				<thead>
					<tr>
						{columns.map((column) => (
							<th
								key={column.key}
								scope="col"
								data-align={column.align}
								aria-sort={
									sort.key === column.key
										? sort.direction === "asc"
											? "ascending"
											: "descending"
										: undefined
								}
							>
								<button type="button" onClick={() => store.toggleSort(column.key)}>
									{column.label}
									<span className="sort-arrow" aria-hidden>
										{sort.key === column.key ? (sort.direction === "asc" ? "↑" : "↓") : ""}
									</span>
								</button>
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{numbers.map((number) => (
						<Row
							key={number}
							store={store}
							number={number}
							compact={compact}
							onOpen={open}
							onKeyDown={onKeyDown}
						/>
					))}
				</tbody>
			</table>
		</div>
	);
}

interface RowProps {
	store: PullRequestListStore;
	number: number;
	compact: boolean;
	onOpen: (row: PullRequestRow) => void;
	onKeyDown: (event: React.KeyboardEvent) => void;
}

const Row = memo(function Row({
	store,
	number,
	compact,
	onOpen,
	onKeyDown,
}: RowProps): React.JSX.Element | null {
	const row = store.useState("row", number);
	const isSelected = store.useState("isSelected", number);
	const isTabStop = store.useState("isTabStop", number);
	const ref = useRef<HTMLTableRowElement>(null);

	// Keeps the keyboard selection in view when it moves off screen.
	useEffect(() => {
		if (isSelected) {
			ref.current?.scrollIntoView({ block: "nearest" });
		}
	}, [isSelected]);

	if (!row) {
		return null;
	}

	const verdict = row.assessment?.verdict;

	return (
		<tr
			ref={ref}
			className="table-row"
			data-number={number}
			data-snoozed={row.derived.snoozed}
			data-closed={row.pullRequest.closedAt !== null}
			aria-selected={isSelected}
			tabIndex={isTabStop ? 0 : -1}
			onClick={() => store.setSelected(number)}
			onDoubleClick={() => onOpen(row)}
			onKeyDown={onKeyDown}
		>
			<td className="cell-number">
				<Tooltip
					content="Open on GitHub"
					render={
						<a
							href={row.pullRequest.url}
							aria-label={`Open pull request ${String(number)} on GitHub`}
							tabIndex={-1}
							// The row is the click target; opening must not select it as well.
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
								onOpen(row);
							}}
						/>
					}
				>
					{number}
				</Tooltip>
			</td>
			<td>
				<span className="cell-title" title={row.pullRequest.title}>
					<Markers row={row} />
					<span className="cell-title-text">{row.pullRequest.title}</span>
				</span>
			</td>
			{compact ? null : (
				<td className="cell-author" title={row.pullRequest.author}>
					{row.pullRequest.author}
				</td>
			)}
			<td>
				{verdict ? (
					<NextAction action={verdict.nextAction} />
				) : (
					<span className="cell-muted">{unassessedLabel(row)}</span>
				)}
			</td>
			<td className="cell-muted" data-align="center">
				{verdict?.priority ? <PriorityGlyph priority={verdict.priority} /> : "—"}
			</td>
			{compact ? null : (
				<>
					<td className="cell-muted" data-align="center">
						{verdict ? <AreaGlyph area={verdict.area} /> : "—"}
					</td>
					<td className="cell-muted" data-align="center">
						{verdict ? <RelevanceGlyph relevance={verdict.relevance} /> : "—"}
					</td>
					<td className="cell-muted">{verdict ? <StatusText status={verdict.status} /> : "—"}</td>
				</>
			)}
			<td data-align="center">
				{verdict ? <EffortBadge effort={verdict.effort} /> : <span className="cell-muted">—</span>}
			</td>
			<td className="cell-numeric">{shortDuration(row.derived.ageDays)}</td>
			<td className="cell-numeric">{shortDuration(row.derived.lastActivityDays)}</td>
		</tr>
	);
});
