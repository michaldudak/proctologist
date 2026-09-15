import { useStableCallback } from "@base-ui/utils/useStableCallback";
import { memo, useEffect, useMemo, useRef } from "react";
import type { PullRequestRow } from "../../../shared/ipc.js";
import { visibleColumns, type Column, type ColumnKey } from "../lib/columns.js";
import { shortDuration } from "../lib/format.js";
import type { PullRequestListStore } from "../state/PullRequestListStore.js";
import { EffortBadge } from "./EffortBadge.js";
import { AuthorMark } from "./AuthorMark.js";
import { Markers } from "./Markers.js";
import { Tooltip } from "./Tooltip.js";
import { NextAction } from "./NextAction.js";
import { AreaGlyph, PriorityGlyph, RelevanceGlyph, StatusText } from "./VerdictGlyphs.js";

/** What stands in for the next action while there is none, and why. */
function unassessedLabel(row: PullRequestRow): string {
	switch (row.activity?.state) {
		case "running": {
			return row.activity.kind === "review_draft" ? "Drafting a review…" : "Assessing…";
		}
		case "queued": {
			return "Queued";
		}
		default: {
			return row.assessment?.error ? "Unassessed" : "Not assessed yet";
		}
	}
}

interface PullRequestTableProps {
	store: PullRequestListStore;
	onOpen: (row: PullRequestRow) => void;
	/** The columns the user asked for; the fixed ones are drawn regardless. */
	columns: readonly ColumnKey[];
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
	columns: chosen,
	compact,
}: PullRequestTableProps): React.JSX.Element {
	const numbers = store.useState("visibleNumbers");
	const sort = store.useState("sort");
	const columns = useMemo(() => visibleColumns(chosen, compact), [chosen, compact]);

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
							columns={columns}
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
	columns: Column[];
	onOpen: (row: PullRequestRow) => void;
	onKeyDown: (event: React.KeyboardEvent) => void;
}

const Row = memo(function Row({
	store,
	number,
	columns,
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

	return (
		<tr
			ref={ref}
			className="table-row"
			data-number={number}
			data-snoozed={row.derived.snoozed}
			data-viewed={row.derived.viewed}
			data-closed={row.pullRequest.closedAt !== null}
			aria-selected={isSelected}
			tabIndex={isTabStop ? 0 : -1}
			onClick={() => store.setSelected(number)}
			onDoubleClick={() => onOpen(row)}
			onKeyDown={onKeyDown}
		>
			{columns.map((column) => (
				<Cell key={column.key} column={column} row={row} onOpen={onOpen} />
			))}
		</tr>
	);
});

interface CellProps {
	column: Column;
	row: PullRequestRow;
	onOpen: (row: PullRequestRow) => void;
}

function Cell({ column, row, onOpen }: CellProps): React.JSX.Element {
	const number = row.pullRequest.number;
	const verdict = row.assessment?.verdict;

	switch (column.key) {
		case "number": {
			return (
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
			);
		}
		case "title": {
			return (
				<td>
					<span className="cell-title" title={row.pullRequest.title}>
						<Markers row={row} />
						<span className="cell-title-text">{row.pullRequest.title}</span>
					</span>
				</td>
			);
		}
		case "author": {
			return (
				<td title={row.pullRequest.author}>
					<span className="cell-author">
						<AuthorMark pullRequest={row.pullRequest} />
						<span className="cell-author-text">{row.pullRequest.author}</span>
					</span>
				</td>
			);
		}
		case "nextAction": {
			return (
				<td>
					{verdict ? (
						<NextAction action={verdict.nextAction} />
					) : (
						<span className="cell-muted">{unassessedLabel(row)}</span>
					)}
				</td>
			);
		}
		case "priority": {
			return (
				<td className="cell-muted" data-align="center">
					{verdict?.priority ? <PriorityGlyph priority={verdict.priority} /> : "—"}
				</td>
			);
		}
		case "area": {
			return (
				<td className="cell-muted" data-align="center">
					{verdict ? <AreaGlyph area={verdict.area} /> : "—"}
				</td>
			);
		}
		case "relevance": {
			return (
				<td className="cell-muted" data-align="center">
					{verdict ? <RelevanceGlyph relevance={verdict.relevance} /> : "—"}
				</td>
			);
		}
		case "status": {
			return (
				<td className="cell-muted">{verdict ? <StatusText status={verdict.status} /> : "—"}</td>
			);
		}
		case "effort": {
			return (
				<td data-align="center">
					{verdict ? (
						<EffortBadge effort={verdict.effort} />
					) : (
						<span className="cell-muted">—</span>
					)}
				</td>
			);
		}
		case "age": {
			return <td className="cell-numeric">{shortDuration(row.derived.ageDays)}</td>;
		}
		case "lastActivity": {
			return <td className="cell-numeric">{shortDuration(row.derived.lastActivityDays)}</td>;
		}
		default: {
			return <td />;
		}
	}
}
