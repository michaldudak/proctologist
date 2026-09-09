import { Button, Input } from "@cloudflare/kumo";
import { useState } from "react";
import { NEXT_ACTION_VALUES } from "@proctologist/core/browser";
import type { PullRequestRow } from "../../../shared/ipc.js";
import {
	EMPTY_FILTERS,
	FACETS,
	FLAGS,
	facetCounts,
	flagCounts,
	isFiltered,
	toggleFacet,
	toggleFlag,
	type Facet,
	type Filters,
} from "../lib/filters.js";
import { facetLabel, flagLabel, valueLabel } from "../lib/format.js";
import { Chip } from "./Chip.js";

interface FilterBarProps {
	rows: PullRequestRow[];
	filters: Filters;
	onChange: (filters: Filters) => void;
	shown: number;
}

/** Values worth a chip even when nothing matches, so the vocabulary stays visible. */
const ALWAYS_SHOWN: Partial<Record<Facet, readonly string[]>> = {
	nextAction: NEXT_ACTION_VALUES,
};

export function FilterBar({ rows, filters, onChange, shown }: FilterBarProps): React.JSX.Element {
	const [expanded, setExpanded] = useState(false);
	const flags = flagCounts(rows, filters);
	const secondaryFacets = FACETS.filter((facet) => facet !== "nextAction");
	const activeSecondary = secondaryFacets.reduce(
		(total, facet) => total + filters.facets[facet].length,
		0,
	);

	return (
		<div className="filters">
			<div className="filter-row">
				<div className="filter-search">
					<Input
						type="search"
						placeholder="Search"
						value={filters.search}
						onChange={(event) => onChange({ ...filters, search: event.target.value })}
						aria-label="Search titles, authors, labels, summaries and notes"
					/>
				</div>
				<span className="header-spacer" />
				<span className="header-meta">
					{shown} of {rows.length}
				</span>
				<Button
					size="xs"
					variant={expanded ? "secondary" : "ghost"}
					onClick={() => setExpanded(!expanded)}
					aria-expanded={expanded}
				>
					More filters{activeSecondary > 0 ? ` (${String(activeSecondary)})` : ""}
				</Button>
				{isFiltered(filters) ? (
					<Button size="xs" variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
						Clear
					</Button>
				) : null}
			</div>

			<Group label={facetLabel("nextAction")}>
				<FacetChips facet="nextAction" rows={rows} filters={filters} onChange={onChange} />
			</Group>

			<Group label="Only">
				{FLAGS.map((flag) => (
					<Chip
						key={flag}
						label={flagLabel(flag)}
						count={flags.get(flag)}
						pressed={filters.flags.includes(flag)}
						onToggle={() => onChange(toggleFlag(filters, flag))}
					/>
				))}
			</Group>

			{/* Its own row because these widen the list, where every other chip here narrows it. */}
			<Group label="Also show">
				<Chip
					label="Snoozed"
					pressed={filters.includeSnoozed}
					onToggle={() => onChange({ ...filters, includeSnoozed: !filters.includeSnoozed })}
				/>
				<Chip
					label="Closed"
					pressed={filters.includeClosed}
					onToggle={() => onChange({ ...filters, includeClosed: !filters.includeClosed })}
				/>
			</Group>

			{expanded ? (
				<div className="filter-panel">
					{secondaryFacets.map((facet) => (
						<Group key={facet} label={facetLabel(facet)}>
							<FacetChips facet={facet} rows={rows} filters={filters} onChange={onChange} />
						</Group>
					))}
				</div>
			) : null}
		</div>
	);
}

/**
 * A named row of chips. Every row is named, including the ones that used to run straight on from
 * the search box: without the names the bar was two banks of pills that had to be read one by one
 * to work out that they were answering different questions.
 */
function Group({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}): React.JSX.Element {
	return (
		<div className="filter-group">
			<span className="filter-group-label">{label}</span>
			<div className="filter-group-chips">{children}</div>
		</div>
	);
}

interface FacetChipsProps {
	facet: Facet;
	rows: PullRequestRow[];
	filters: Filters;
	onChange: (filters: Filters) => void;
}

function FacetChips({ facet, rows, filters, onChange }: FacetChipsProps): React.JSX.Element {
	const counts = facetCounts(rows, filters, facet);
	const values = [
		...new Set([...(ALWAYS_SHOWN[facet] ?? []), ...counts.keys(), ...filters.facets[facet]]),
	];

	return (
		<>
			{values.map((value) => (
				<Chip
					key={value}
					label={valueLabel(facet, value)}
					count={counts.get(value) ?? 0}
					pressed={filters.facets[facet].includes(value)}
					onToggle={() => onChange(toggleFacet(filters, facet, value))}
				/>
			))}
		</>
	);
}
