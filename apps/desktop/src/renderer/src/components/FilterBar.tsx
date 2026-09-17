import { Button, Combobox, DropdownMenu, Input } from "@cloudflare/kumo";
import { CaretDownIcon, MagnifyingGlassIcon, type Icon } from "@phosphor-icons/react";
import {
	EFFORT_VALUES,
	NEXT_ACTION_VALUES,
	PRIORITY_VALUES,
	type NextAction,
	type Priority,
} from "@proctologist/core/browser";
import type { ItemRow } from "../../../shared/ipc.js";
import { columnsFor, toggleColumn, type ColumnKey, type ColumnKinds } from "../lib/columns.js";
import {
	authorOptions,
	EMPTY_FILTERS,
	facetCounts,
	flagCounts,
	isFiltered,
	toggleFacet,
	toggleFlag,
	type Facet,
	type Filters,
	facetsFor,
	flagsFor,
} from "../lib/filters.js";
import { facetLabel, flagLabel, valueLabel } from "../lib/format.js";
import { NEXT_ACTION_ICONS } from "./NextAction.js";
import { PRIORITY_ICONS } from "./VerdictGlyphs.js";

interface FilterBarProps {
	rows: ItemRow[];
	filters: Filters;
	onChange: (filters: Filters) => void;
	shown: number;
	columns: readonly ColumnKey[];
	onColumnsChange: (columns: readonly ColumnKey[]) => void;
	/** Which kind is on show: the facets, flags and columns are the kind's, the bar is shared. */
	kind: ColumnKinds;
	allRepositories: boolean;
	/** The login `gh` is signed in as; the author menu pins it on top. Null until known. */
	viewer: string | null;
}

/** Values worth an option even when nothing matches, so the vocabulary stays visible. */
const ALWAYS_SHOWN: Partial<Record<Facet, readonly string[]>> = {
	nextAction: NEXT_ACTION_VALUES,
	priority: PRIORITY_VALUES,
	effort: EFFORT_VALUES,
};

/** The facets whose values have an icon in the table, so the menu can show the same one. */
function facetIcon(facet: Facet, value: string): Icon | undefined {
	switch (facet) {
		case "nextAction": {
			return NEXT_ACTION_ICONS[value as NextAction];
		}
		case "priority": {
			return PRIORITY_ICONS[value as Priority];
		}
		default: {
			return undefined;
		}
	}
}

/**
 * One row: search, then a menu per facet, then a menu of the yes-or-no properties. A menu's button
 * says what is picked, so the state is readable without opening anything, and the bar is the same
 * height whatever is picked. The counts inside say what choosing an option would leave. The
 * columns menu sits at the far end: it changes what the table shows, not which rows it shows.
 */
export function FilterBar({
	rows,
	filters,
	onChange,
	shown,
	columns,
	onColumnsChange,
	kind,
	allRepositories,
	viewer,
}: FilterBarProps): React.JSX.Element {
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
			{facetsFor(kind, allRepositories).map((facet) =>
				facet === "author" ? (
					<AuthorMenu
						key={facet}
						rows={rows}
						filters={filters}
						onChange={onChange}
						viewer={viewer}
					/>
				) : (
					<FacetMenu key={facet} facet={facet} rows={rows} filters={filters} onChange={onChange} />
				),
			)}
			<DropdownMenu>
				<MenuTrigger name="Show" picked={showing} />
				<DropdownMenu.Content align="start" className="filter-menu-content">
					<DropdownMenu.Group>
						<DropdownMenu.Label>Only</DropdownMenu.Label>
						{flagsFor(kind).map((flag) => (
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
			<ColumnsMenu
				columns={columns}
				onChange={onColumnsChange}
				kind={kind}
				allRepositories={allRepositories}
			/>
		</div>
	);
}

interface FacetMenuProps {
	facet: Facet;
	rows: ItemRow[];
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
			<DropdownMenu.Content align="start" className="filter-menu-content facet-menu-content">
				{values.map((value) => {
					const count = counts.get(value) ?? 0;
					const Symbol = facetIcon(facet, value);
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

interface AuthorMenuProps {
	rows: ItemRow[];
	filters: Filters;
	onChange: (filters: Filters) => void;
	viewer: string | null;
}

/**
 * The author facet as a searchable menu. Logins are an open set that grows with the repository,
 * so unlike the judged facets this one starts with a search field — and the user's own account
 * sits pinned on top, marked "(you)", because it is the login reached for most.
 */
function AuthorMenu({ rows, filters, onChange, viewer }: AuthorMenuProps): React.JSX.Element {
	const counts = facetCounts(rows, filters, "author");
	const selected = filters.facets.author;
	const values = authorOptions(counts, selected, viewer);

	return (
		<Combobox
			multiple
			items={values}
			value={selected}
			onValueChange={(next) =>
				onChange({ ...filters, facets: { ...filters.facets, author: next as string[] } })
			}
		>
			<Combobox.TriggerValue
				render={<button type="button" className="filter-menu" data-active={selected.length > 0} />}
			>
				{() => (
					<>
						{selected.length === 0 ? (
							"Author"
						) : (
							<>
								<span className="filter-menu-name">Author:</span>{" "}
								{selected.length === 1 ? selected[0] : String(selected.length)}
							</>
						)}
						<CaretDownIcon size={11} weight="bold" aria-hidden />
					</>
				)}
			</Combobox.TriggerValue>
			<Combobox.Content align="start" className="filter-menu-content author-menu-content">
				<div className="facet-menu-search">
					<Combobox.Input placeholder="Search authors" />
				</div>
				<Combobox.List>
					{(value: string) => {
						const count = counts.get(value) ?? 0;
						return (
							<Combobox.Item
								key={value}
								value={value}
								disabled={count === 0 && !selected.includes(value)}
							>
								<Option
									label={value}
									suffix={value === viewer ? <span className="menu-you">(you)</span> : null}
									count={count}
								/>
							</Combobox.Item>
						);
					}}
				</Combobox.List>
				<Combobox.Empty>Nobody matches</Combobox.Empty>
			</Combobox.Content>
		</Combobox>
	);
}

interface ColumnsMenuProps {
	columns: readonly ColumnKey[];
	onChange: (columns: readonly ColumnKey[]) => void;
	kind: ColumnKinds;
	allRepositories: boolean;
}

/** Which columns the table draws. The fixed ones are listed, ticked, so the list reads complete. */
function ColumnsMenu({
	columns,
	onChange,
	kind,
	allRepositories,
}: ColumnsMenuProps): React.JSX.Element {
	return (
		<DropdownMenu>
			<MenuTrigger name="Columns" picked={[]} />
			<DropdownMenu.Content align="end" className="filter-menu-content">
				<DropdownMenu.Group>
					<DropdownMenu.Label>Columns</DropdownMenu.Label>
					{columnsFor(kind, allRepositories).map((column) => (
						<DropdownMenu.CheckboxItem
							key={column.key}
							checked={column.fixed === true || columns.includes(column.key)}
							disabled={column.fixed === true}
							onCheckedChange={() => onChange(toggleColumn(columns, column.key))}
						>
							{column.key === "number" ? "Number" : column.label}
						</DropdownMenu.CheckboxItem>
					))}
				</DropdownMenu.Group>
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
	suffix,
}: {
	label: string;
	count: number | undefined;
	icon?: React.ReactNode;
	suffix?: React.ReactNode;
}): React.JSX.Element {
	return (
		<span className="menu-option">
			<span className="menu-option-label">
				{icon}
				{label}
				{suffix}
			</span>
			<span className="menu-count">{count}</span>
		</span>
	);
}
