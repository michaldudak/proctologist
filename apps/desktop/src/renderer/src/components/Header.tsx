import { DropdownMenu } from "@cloudflare/kumo";
import { CaretDownIcon } from "@phosphor-icons/react";
import type { RepositorySummary } from "../../../shared/ipc.js";
import { refreshedAt } from "../lib/format.js";

interface HeaderProps {
	repositories: RepositorySummary[];
	selected: string | null;
	onSelect: (repository: string) => void;
	/** The refresh control, which needs the api and so is built by the caller. */
	children?: React.ReactNode;
}

export function Header({
	repositories,
	selected,
	onSelect,
	children,
}: HeaderProps): React.JSX.Element {
	const current = repositories.find((repository) => repository.name === selected);

	return (
		<header className="header">
			<span className="header-title">PRoctologist</span>
			{repositories.length > 1 ? (
				<RepositorySwitcher repositories={repositories} selected={selected} onSelect={onSelect} />
			) : current ? (
				<span className="header-meta">{current.name}</span>
			) : null}

			<span className="header-spacer" />

			{current ? (
				<>
					<span className="header-meta">
						{current.lastRefresh && current.lastRefresh.outcome !== "failed"
							? `Refreshed ${refreshedAt(current.lastRefresh.finishedAt)}`
							: "Never refreshed"}
					</span>
				</>
			) : null}
			{children}
		</header>
	);
}

/**
 * The tracked repositories as a menu, only ever shown when there is a choice: with a single one
 * its name is plain text in the same place. The trigger says which is open, so the header reads the
 * same whether or not the menu exists.
 */
function RepositorySwitcher({
	repositories,
	selected,
	onSelect,
}: Pick<HeaderProps, "repositories" | "selected" | "onSelect">): React.JSX.Element {
	return (
		<DropdownMenu>
			<DropdownMenu.Trigger
				render={<button type="button" className="repository-switcher" aria-label="Repository" />}
			>
				{selected ?? "Choose a repository"}
				<CaretDownIcon size={11} weight="bold" aria-hidden />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start" className="menu-content">
				<DropdownMenu.RadioGroup
					value={selected}
					onValueChange={(value) => onSelect(value as string)}
				>
					{repositories.map((repository) => (
						<DropdownMenu.RadioItem key={repository.name} value={repository.name} closeOnClick>
							<span className="repository-option">{repository.name}</span>
							<DropdownMenu.RadioItemIndicator />
						</DropdownMenu.RadioItem>
					))}
				</DropdownMenu.RadioGroup>
			</DropdownMenu.Content>
		</DropdownMenu>
	);
}
