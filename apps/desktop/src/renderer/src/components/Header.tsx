import { Badge, Button } from "@cloudflare/kumo";
import type { RepositorySummary } from "../../../shared/ipc.js";
import { absoluteDate } from "../lib/format.js";

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
				<nav className="repository-switcher" aria-label="Repository">
					{repositories.map((repository) => (
						<Button
							key={repository.name}
							size="xs"
							variant={repository.name === selected ? "secondary" : "ghost"}
							aria-current={repository.name === selected}
							onClick={() => onSelect(repository.name)}
						>
							{repository.name}
						</Button>
					))}
				</nav>
			) : current ? (
				<span className="header-meta">{current.name}</span>
			) : null}

			<span className="header-spacer" />

			{current ? (
				<>
					{current.quickWins > 0 ? (
						<Badge variant="teal-subtle">{current.quickWins} quick wins</Badge>
					) : null}
					{current.unassessed > 0 ? (
						<Badge variant="warning">{current.unassessed} unassessed</Badge>
					) : null}
					{current.lastRefresh?.outcome === "failed" ? (
						<span className="error" title={current.lastRefresh.error ?? undefined}>
							Last refresh failed
						</span>
					) : (
						<span className="header-meta">
							{current.lastRefresh
								? `Refreshed ${absoluteDate(current.lastRefresh.finishedAt)}`
								: "Never refreshed"}
						</span>
					)}
				</>
			) : null}
			{children}
		</header>
	);
}
