import { useEffect, useState } from "react";
import type { RepositorySummary } from "../../shared/ipc.js";
import { api } from "./api.js";

/** A placeholder while the real views are built; it proves the bridge works end to end. */
export function App(): React.JSX.Element {
	const [repositories, setRepositories] = useState<RepositorySummary[] | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);

	useEffect(() => {
		const load = (): void => {
			api.listRepositories().then(setRepositories, (cause: unknown) => {
				setError(cause instanceof Error ? cause.message : String(cause));
			});
		};
		load();
		return api.on("data-changed", load);
	}, []);

	if (error !== undefined) {
		return <p role="alert">{error}</p>;
	}
	if (repositories === undefined) {
		return <p>Loading…</p>;
	}
	if (repositories.length === 0) {
		return <p>No repositories are tracked yet.</p>;
	}

	return (
		<ul>
			{repositories.map((repository) => (
				<li key={repository.name}>
					{repository.name} — {repository.open} open, {repository.quickWins} quick wins
				</li>
			))}
		</ul>
	);
}
