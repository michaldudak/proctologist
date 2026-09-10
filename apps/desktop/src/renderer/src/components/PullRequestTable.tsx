import { useEffect, useRef } from "react";
import type { PullRequestRow } from "../../../shared/ipc.js";
import type { SortDirection, SortKey } from "../lib/filters.js";
import { shortDuration } from "../lib/format.js";
import { EffortBadge } from "./EffortBadge.js";
import { Markers } from "./Markers.js";
import { Tooltip } from "./Tooltip.js";
import { NextAction } from "./NextAction.js";
import { CategoryGlyph, RelevanceGlyph, StatusText } from "./VerdictGlyphs.js";

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
	{ key: "nextAction", label: "Next action", width: "8.5rem" },
	{ key: "category", label: "Category", width: "6rem", align: "center", secondary: true },
	{ key: "relevance", label: "Relevance", width: "6.25rem", align: "center", secondary: true },
	{ key: "status", label: "Status", width: "9.5rem", secondary: true },
	{ key: "effort", label: "Effort", width: "4.5rem", align: "center" },
	{ key: "age", label: "Age", width: "3.5rem", align: "right" },
	{ key: "lastActivity", label: "Activity", width: "4.5rem", align: "right" },
];

interface PullRequestTableProps {
	rows: PullRequestRow[];
	selected: number | null;
	onSelect: (number: number) => void;
	onOpen: (row: PullRequestRow) => void;
	sort: { key: SortKey; direction: SortDirection };
	onSort: (key: SortKey) => void;
	/** True while the side panel takes half the window. */
	compact: boolean;
}

export function PullRequestTable({
	rows,
	selected,
	onSelect,
	onOpen,
	sort,
	onSort,
	compact,
}: PullRequestTableProps): React.JSX.Element {
	const bodyRef = useRef<HTMLTableSectionElement>(null);
	const columns = compact ? COLUMNS.filter((column) => !column.secondary) : COLUMNS;

	// Keeps the keyboard selection in view when it moves off screen.
	useEffect(() => {
		if (selected === null) {
			return;
		}
		bodyRef.current
			?.querySelector(`[data-number="${String(selected)}"]`)
			?.scrollIntoView({ block: "nearest" });
	}, [selected]);

	const move = (delta: number): void => {
		if (rows.length === 0) {
			return;
		}
		const index = rows.findIndex((row) => row.pullRequest.number === selected);
		const next = index === -1 ? 0 : Math.min(Math.max(index + delta, 0), rows.length - 1);
		const row = rows[next];
		if (row) {
			onSelect(row.pullRequest.number);
		}
	};

	const onKeyDown = (event: React.KeyboardEvent): void => {
		switch (event.key) {
			case "ArrowDown":
			case "j": {
				event.preventDefault();
				move(1);
				break;
			}
			case "ArrowUp":
			case "k": {
				event.preventDefault();
				move(-1);
				break;
			}
			case "Enter": {
				const row = rows.find((item) => item.pullRequest.number === selected);
				if (row) {
					event.preventDefault();
					onOpen(row);
				}
				break;
			}
			default: {
				break;
			}
		}
	};

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
								<button type="button" onClick={() => onSort(column.key)}>
									{column.label}
									<span className="sort-arrow" aria-hidden>
										{sort.key === column.key ? (sort.direction === "asc" ? "↑" : "↓") : ""}
									</span>
								</button>
							</th>
						))}
					</tr>
				</thead>
				<tbody ref={bodyRef}>
					{rows.map((row) => {
						const verdict = row.assessment?.verdict;
						const isSelected = row.pullRequest.number === selected;

						return (
							<tr
								key={row.pullRequest.number}
								className="table-row"
								data-number={row.pullRequest.number}
								data-snoozed={row.derived.snoozed}
								data-closed={row.pullRequest.closedAt !== null}
								aria-selected={isSelected}
								tabIndex={isSelected || (selected === null && rows[0] === row) ? 0 : -1}
								onClick={() => onSelect(row.pullRequest.number)}
								onDoubleClick={() => onOpen(row)}
								onKeyDown={onKeyDown}
							>
								<td className="cell-number">
									<Tooltip
										content="Open on GitHub"
										render={
											<a
												href={row.pullRequest.url}
												aria-label={`Open pull request ${String(row.pullRequest.number)} on GitHub`}
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
										{row.pullRequest.number}
									</Tooltip>
								</td>
								<td>
									<span className="cell-title" title={row.pullRequest.title}>
										<Markers row={row} />
										<span className="cell-title-text">{row.pullRequest.title}</span>
									</span>
								</td>
								<td>
									{verdict ? (
										<NextAction action={verdict.nextAction} />
									) : (
										<span className="cell-muted">{unassessedLabel(row)}</span>
									)}
								</td>
								{compact ? null : (
									<>
										<td className="cell-muted" data-align="center">
											{verdict ? <CategoryGlyph category={verdict.category} /> : "—"}
										</td>
										<td className="cell-muted" data-align="center">
											{verdict ? <RelevanceGlyph relevance={verdict.relevance} /> : "—"}
										</td>
										<td className="cell-muted">
											{verdict ? <StatusText status={verdict.status} /> : "—"}
										</td>
									</>
								)}
								<td data-align="center">
									{verdict ? (
										<EffortBadge effort={verdict.effort} />
									) : (
										<span className="cell-muted">—</span>
									)}
								</td>
								<td className="cell-numeric">{shortDuration(row.derived.ageDays)}</td>
								<td className="cell-numeric">{shortDuration(row.derived.lastActivityDays)}</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}
