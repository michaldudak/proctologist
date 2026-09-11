import { Badge } from "@cloudflare/kumo";
import { useStableCallback } from "@base-ui/utils/useStableCallback";
import { isIssue } from "@proctologist/core/browser";
import { memo, useEffect, useMemo, useRef } from "react";
import type { ItemRow } from "../../../shared/ipc.js";
import { visibleColumns, type Column, type ColumnKey, type ColumnKinds } from "../lib/columns.js";
import { shortDuration, valueLabel } from "../lib/format.js";
import type { ItemListStore } from "../state/ItemListStore.js";
import { EffortBadge } from "./EffortBadge.js";
import { AuthorMark } from "./AuthorMark.js";
import { Markers } from "./Markers.js";
import { Tooltip } from "./Tooltip.js";
import { NextAction } from "./NextAction.js";
import { AreaGlyph, PriorityGlyph, RelevanceGlyph, StatusText } from "./VerdictGlyphs.js";

/** What stands in for the next action while there is none, and why. */
function unassessedLabel(row: ItemRow): string {
	switch (row.activity?.state) {
		case "running": {
			return row.activity.job === "review_draft" ? "Drafting a review…" : "Assessing…";
		}
		case "queued": {
			return "Queued";
		}
		default: {
			return row.assessment?.error ? "Unassessed" : "Not assessed yet";
		}
	}
}

interface ItemTableProps {
	store: ItemListStore;
	onOpen: (row: ItemRow) => void;
	/** The columns the user asked for; the fixed ones are drawn regardless. */
	columns: readonly ColumnKey[];
	/** True while the side panel takes half the window. */
	compact: boolean;
	/** Which kind is on show, which decides the column set. */
	kind: ColumnKinds;
	/** True at the All scope, where the Repository column earns its place. */
	allRepositories: boolean;
}

/**
 * The table subscribes to the order of the rows and nothing more; each row subscribes to itself.
 * An assessment landing on one pull request therefore redraws that row alone, and the rest of the
 * list sits still while the agent works through it.
 */
export function ItemTable({
	store,
	onOpen,
	columns: chosen,
	compact,
	kind,
	allRepositories,
}: ItemTableProps): React.JSX.Element {
	const keys = store.useState("visibleKeys");
	const sort = store.useState("sort");
	// What the header checkbox reads: every row matching the filters, not the ones on screen.
	const checkedVisible = store.useState("checkedVisible");
	const allChecked = keys.length > 0 && checkedVisible.length === keys.length;
	const someChecked = checkedVisible.length > 0;
	const columns = useMemo(
		() => visibleColumns(chosen, { compact, kind, allRepositories }),
		[chosen, compact, kind, allRepositories],
	);

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
			case "x": {
				// Ticks the row the cursor is on, so picking out a handful never needs the mouse.
				const { selected } = store.state;
				if (selected !== null) {
					event.preventDefault();
					store.toggleChecked(selected);
				}
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
					<col style={{ width: "2.25rem" }} />
					{columns.map((column) => (
						<col key={column.key} style={{ width: column.width }} />
					))}
				</colgroup>
				<thead>
					<tr>
						<th scope="col" className="table-check">
							<input
								type="checkbox"
								checked={allChecked}
								ref={(node) => {
									if (node) {
										node.indeterminate = someChecked && !allChecked;
									}
								}}
								aria-label={
									allChecked ? "Clear the picked out rows" : `Pick out all ${String(keys.length)}`
								}
								onChange={() => {
									store.setAllVisibleChecked(!allChecked);
								}}
							/>
						</th>
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
					{keys.map((key) => (
						<Row
							key={key}
							store={store}
							itemKey={key}
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
	store: ItemListStore;
	itemKey: string;
	columns: Column[];
	onOpen: (row: ItemRow) => void;
	onKeyDown: (event: React.KeyboardEvent) => void;
}

const Row = memo(function Row({
	store,
	itemKey: key,
	columns,
	onOpen,
	onKeyDown,
}: RowProps): React.JSX.Element | null {
	const row = store.useState("row", key);
	const isSelected = store.useState("isSelected", key);
	const isTabStop = store.useState("isTabStop", key);
	const isChecked = store.useState("isChecked", key);
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
			data-key={key}
			data-snoozed={row.derived.snoozed}
			data-closed={row.item.closedAt !== null}
			aria-selected={isSelected}
			tabIndex={isTabStop ? 0 : -1}
			onClick={(event) => {
				if (event.shiftKey && store.state.selected !== null) {
					store.checkRange(store.state.selected, key);
					return;
				}
				store.setSelected(key);
			}}
			onDoubleClick={() => onOpen(row)}
			onKeyDown={onKeyDown}
		>
			<td className="table-check">
				<input
					type="checkbox"
					checked={isChecked}
					aria-label={`Pick out #${String(row.item.number)}`}
					onClick={(event) => {
						event.stopPropagation();
					}}
					onChange={() => {
						store.toggleChecked(key);
					}}
				/>
			</td>
			{columns.map((column) => (
				<Cell key={column.key} column={column} row={row} onOpen={onOpen} />
			))}
		</tr>
	);
});

interface CellProps {
	column: Column;
	row: ItemRow;
	onOpen: (row: ItemRow) => void;
}

function Cell({ column, row, onOpen }: CellProps): React.JSX.Element {
	const number = row.item.number;
	const verdict = row.assessment?.verdict;

	switch (column.key) {
		case "number": {
			return (
				<td className="cell-number">
					<Tooltip
						content="Open on GitHub"
						render={
							<a
								href={row.item.url}
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
					<span className="cell-title" title={row.item.title}>
						<Markers row={row} />
						<span className="cell-title-text">{row.item.title}</span>
					</span>
				</td>
			);
		}
		case "author": {
			return (
				<td title={row.item.author}>
					<span className="cell-author">
						<AuthorMark item={row.item} />
						<span className="cell-author-text">{row.item.author}</span>
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
		case "repository": {
			return <td className="cell-repository">{row.item.repository}</td>;
		}
		case "type": {
			const type = row.assessment?.verdict?.type;
			return (
				<td data-align="center">
					{type ? <Badge variant="secondary">{valueLabel("type", type)}</Badge> : null}
				</td>
			);
		}
		case "comments": {
			return <td className="cell-numeric">{isIssue(row.item) ? row.item.comments || "" : ""}</td>;
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
