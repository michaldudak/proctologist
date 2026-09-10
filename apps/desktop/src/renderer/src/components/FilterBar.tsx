import { Button, DropdownMenu, Input } from "@cloudflare/kumo";
import { CaretDownIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import { NEXT_ACTION_VALUES, type NextAction } from "@proctologist/core/browser";
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
import { NEXT_ACTION_ICONS } from "./NextAction.js";

interface FilterBarProps {
	rows: PullRequestRow[];
	filters: Filters;
	onChange: (filters: Filters) => void;
	shown: number;
}

/** Values worth an option even when nothing matches, so the vocabulary stays visible. */
const ALWAYS_SHOWN: Partial<Record<Facet, readonly string[]>> = {
	nextAction: NEXT_ACTION_VALUES,
};

/**
 * One row: search, then a menu per facet, then a menu of the yes-or-no properties. A menu's button
 * says what is picked, so the state is readable without opening anything, and the bar is the same
 * height whatever is picked. The counts inside say what choosing an option would leave.
 */
export function FilterBar({ rows, filters, onChange, shown }: FilterBarProps): React.JSX.Element {
	const flags = flagCounts(rows, filters);
	const showing = [
		...filters.flags.map(flagLabel),
		...(filters.includeSnoozed ? ["snoozed"] : []),
		...(filters.includeClosed ? ["closed"] : []),
	];

	return (
		<div className="filters">
			<div className="filter-search">
				<MagnifyingGlassIcon size={14} aria-hidden className="filter-search-icon" />
				<Input
					type="search"
					placeholder="Search"
					value={filters.search}
					onChange={(event) => onChange({ ...filters, search: event.target.value })}
					aria-label="Search titles, authors, labels, summaries and notes"
				/>
			</div>
			{FACETS.map((facet) => (
				<FacetMenu key={facet} facet={facet} rows={rows} filters={filters} onChange={onChange} />
			))}
			<DropdownMenu>
				<MenuTrigger name="Show" picked={showing} />
				<DropdownMenu.Content align="start">
					<DropdownMenu.Group>
						<DropdownMenu.Label>Only</DropdownMenu.Label>
						{FLAGS.map((flag) => (
							<DropdownMenu.CheckboxItem
								key={flag}
								checked={filters.flags.includes(flag)}
								onCheckedChange={() => onChange(toggleFlag(filters, flag))}
								disabled={flags.get(flag) === 0 && !filters.flags.includes(flag)}
							>
								<Option label={flagLabel(flag)} count={flags.get(flag)} />
							</DropdownMenu.CheckboxItem>
						))}
					</DropdownMenu.Group>
					<DropdownMenu.Separator />
					{/* Its own section because these widen the list, where everything else narrows it. */}
					<DropdownMenu.Group>
						<DropdownMenu.Label>Also show</DropdownMenu.Label>
						<DropdownMenu.CheckboxItem
							checked={filters.includeSnoozed}
							onCheckedChange={() =>
								onChange({ ...filters, includeSnoozed: !filters.includeSnoozed })
							}
						>
							Snoozed
						</DropdownMenu.CheckboxItem>
						<DropdownMenu.CheckboxItem
							checked={filters.includeClosed}
							onCheckedChange={() =>
								onChange({ ...filters, includeClosed: !filters.includeClosed })
							}
						>
							Closed
						</DropdownMenu.CheckboxItem>
					</DropdownMenu.Group>
				</DropdownMenu.Content>
			</DropdownMenu>
			<span className="header-spacer" />
			<span className="header-meta">
				{shown} of {rows.length}
			</span>
			{isFiltered(filters) ? (
				<Button size="xs" variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
					Clear
				</Button>
			) : null}
		</div>
	);
}

interface FacetMenuProps {
	facet: Facet;
	rows: PullRequestRow[];
	filters: Filters;
	onChange: (filters: Filters) => void;
}

function FacetMenu({ facet, rows, filters, onChange }: FacetMenuProps): React.JSX.Element {
	const counts = facetCounts(rows, filters, facet);
	const selected = filters.facets[facet];
	const values = [...new Set([...(ALWAYS_SHOWN[facet] ?? []), ...counts.keys(), ...selected])];
	// Judged facets list their vocabulary in its own order; authors are an open set, so they are
	// listed alphabetically to be found rather than in the order the rows happen to be in.
	if (facet === "author") {
		values.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
	}

	return (
		<DropdownMenu>
			<MenuTrigger
				name={facetLabel(facet)}
				picked={selected.map((value) => valueLabel(facet, value))}
			/>
			<DropdownMenu.Content align="start" className="facet-menu-content">
				{values.map((value) => {
					const count = counts.get(value) ?? 0;
					const Symbol =
						facet === "nextAction" ? NEXT_ACTION_ICONS[value as NextAction] : undefined;
					return (
						<DropdownMenu.CheckboxItem
							key={value}
							checked={selected.includes(value)}
							onCheckedChange={() => onChange(toggleFacet(filters, facet, value))}
							disabled={count === 0 && !selected.includes(value)}
						>
							<Option
								label={valueLabel(facet, value)}
								count={count}
								icon={Symbol ? <Symbol size={13} weight="bold" aria-hidden /> : null}
							/>
						</DropdownMenu.CheckboxItem>
					);
				})}
			</DropdownMenu.Content>
		</DropdownMenu>
	);
}

/** "Status" with nothing picked, "Status: Stalled" with one thing, "Status: 2" with more. */
function MenuTrigger({ name, picked }: { name: string; picked: string[] }): React.JSX.Element {
	return (
		<DropdownMenu.Trigger
			render={<button type="button" className="filter-menu" data-active={picked.length > 0} />}
		>
			{picked.length === 0 ? (
				name
			) : (
				<>
					<span className="filter-menu-name">{name}:</span>{" "}
					{picked.length === 1 ? picked[0] : String(picked.length)}
				</>
			)}
			<CaretDownIcon size={11} weight="bold" aria-hidden />
		</DropdownMenu.Trigger>
	);
}

function Option({
	label,
	count,
	icon,
}: {
	label: string;
	count: number | undefined;
	icon?: React.ReactNode;
}): React.JSX.Element {
	return (
		<span className="menu-option">
			<span className="menu-option-label">
				{icon}
				{label}
			</span>
			<span className="menu-count">{count}</span>
		</span>
	);
}
