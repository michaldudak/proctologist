import { useStableCallback } from "@base-ui/utils/useStableCallback";
import { memo, useEffect, useMemo, useRef } from "react";
import { isIssue } from "@proctologist/core/browser";
import { Virtualizer } from "base-ui-virtualizer/virtualizer";
import type { ItemRow } from "../../../shared/ipc.js";
import { visibleColumns, type Column, type ColumnKey, type ColumnKinds } from "../lib/columns.js";
import { shortDuration, votesLabel } from "../lib/format.js";
import { itemKey, type ItemListStore } from "../state/ItemListStore.js";
import { EffortBadge } from "./EffortBadge.js";
import { AuthorMark } from "./AuthorMark.js";
import { Markers } from "./Markers.js";
import { Tooltip } from "./Tooltip.js";
import { NextAction } from "./NextAction.js";
import { AreaGlyph, PriorityGlyph, RelevanceGlyph, StatusText } from "./VerdictGlyphs.js";

/**
 * What a row measures, from the rendered table rather than from arithmetic on the CSS. The
 * virtualizer refines it from what it measures, but the estimate is what it reserves space with
 * for everything it has not drawn yet, so an estimate well under the truth leaves the scrollable
 * height short and sends scroll-to-index to the wrong place.
 */
const ROW_HEIGHT = 36;

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
	const rows = store.useState("visible");
	const selected = store.useState("selected");
	const actions = useRef<Virtualizer.Actions>(null);
	const scroller = useRef<HTMLDivElement>(null);
	// The virtualizer moves a cursor by index; the store keeps it by key, which is what survives a
	// reload reordering the rows. This is the only place the two meet.
	const activeIndex = selected === null ? null : keys.indexOf(selected);
	const sort = store.useState("sort");
	const filters = store.useState("filters");
	// What the header checkbox reads: every row matching the filters, not the ones on screen.
	const checkedVisible = store.useState("checkedVisible");
	const allChecked = keys.length > 0 && checkedVisible.length === keys.length;
	const someChecked = checkedVisible.length > 0;
	const columns = useMemo(
		() => visibleColumns(chosen, { compact, kind, allRepositories }),
		[chosen, compact, kind, allRepositories],
	);

	/*
	 * Sorting or filtering makes a different list, and the scroll offset means nothing in it: a
	 * click on a column header a thousand rows down otherwise leaves the user in an arbitrary
	 * middle of the new order, looking at rows that answer no question they asked. Skipped on the
	 * first render, which has nowhere to return from.
	 */
	const settled = useRef(false);
	useEffect(() => {
		if (settled.current) {
			actions.current?.scrollToIndex(0, { align: "start" });
		}
		settled.current = true;
	}, [sort, filters]);

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
				const cursor = store.state.selected;
				if (cursor !== null) {
					event.preventDefault();
					store.toggleChecked(cursor);
				}
				break;
			}
			case "Enter": {
				const cursor = store.state.selected;
				const row = cursor === null ? undefined : store.select("row", cursor);
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
		// The rows are what the keyboard drives, but a row outside the window is not mounted, so the
		// handler sits on the scroll container the focused row bubbles to.
		// oxlint-disable-next-line jsx-a11y/no-static-element-interactions
		<div className="table-scroll" ref={scroller} onKeyDown={onKeyDown} tabIndex={-1}>
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
				<Virtualizer<ItemRow>
					actionsRef={actions}
					items={rows}
					getItemKey={itemKey}
					layout="table"
					// Every row is one line of text, so one estimate serves; the virtualizer refines it
					// from what it measures either way.
					estimatedItemHeight={ROW_HEIGHT}
					activeIndex={activeIndex === null || activeIndex === -1 ? null : activeIndex}
				>
					{(row, _index, rowProps) => (
						<Row
							store={store}
							itemKey={itemKey(row)}
							rowProps={rowProps}
							columns={columns}
							onOpen={open}
						/>
					)}
				</Virtualizer>
			</table>
		</div>
	);
}

interface RowProps {
	store: ItemListStore;
	itemKey: string;
	columns: Column[];
	onOpen: (row: ItemRow) => void;
	/** What the virtualizer needs on the row it asked for: its index and its measurement hooks. */
	rowProps: Virtualizer.ItemProps;
}

const Row = memo(function Row({
	store,
	itemKey: key,
	columns,
	onOpen,
	rowProps,
}: RowProps): React.JSX.Element | null {
	const row = store.useState("row", key);
	const isSelected = store.useState("isSelected", key);
	const isTabStop = store.useState("isTabStop", key);
	const isChecked = store.useState("isChecked", key);
	const ref = useRef<HTMLTableRowElement>(null);

	// The cursor takes focus so the keyboard follows it. The virtualizer keeps the active row
	// mounted even outside the window and scrolls it into view itself, so `preventScroll` stops the
	// browser doing it a second time.
	useEffect(() => {
		if (isSelected && ref.current?.contains(document.activeElement) === false) {
			ref.current.focus({ preventScroll: true });
		}
	}, [isSelected]);

	if (!row) {
		return null;
	}

	return (
		<tr
			{...rowProps}
			ref={ref}
			className="table-row"
			data-key={key}
			data-snoozed={row.derived.snoozed}
			data-closed={row.item.closedAt !== null}
			aria-selected={isSelected}
			tabIndex={isTabStop ? 0 : -1}
			// Shift-clicking extends the browser's own text selection, which paints half the table
			// blue over whatever range was meant. The selection starts on mousedown, so that is
			// where it has to be refused.
			onMouseDown={(event) => {
				if (event.shiftKey) {
					event.preventDefault();
				}
			}}
			onClick={(event) => {
				if (event.shiftKey) {
					const anchor = store.state.lastToggled ?? store.state.selected;
					if (anchor !== null) {
						store.setRangeChecked(anchor, key, true);
						return;
					}
				}
				store.setSelected(key);
			}}
			onDoubleClick={() => onOpen(row)}
		>
			<td className="table-check">
				<input
					type="checkbox"
					checked={isChecked}
					aria-label={`Pick out #${String(row.item.number)}`}
					onMouseDown={(event) => {
						if (event.shiftKey) {
							event.preventDefault();
						}
					}}
					onClick={(event) => {
						event.stopPropagation();
						const anchor = store.state.lastToggled;
						if (!event.shiftKey || anchor === null || anchor === key) {
							return;
						}
						// Taking the range on ourselves; the box must not also toggle on its own, so
						// the click's default is refused and `onChange` never fires.
						event.preventDefault();
						store.setRangeChecked(anchor, key, !isChecked);
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
		case "comments": {
			return <td className="cell-numeric">{isIssue(row.item) ? row.item.comments || "" : ""}</td>;
		}
		case "votes": {
			if (!isIssue(row.item)) {
				return <td />;
			}
			const { upvotes, downvotes } = row.item;
			return <td className="cell-numeric">{votesLabel(upvotes, downvotes)}</td>;
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
