import { useEffect, useState } from "react";
import { useApi } from "../api.js";
import { PullRequestListStore } from "./PullRequestListStore.js";
import { RELOAD_DELAY } from "./useData.js";

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The main table's store, kept in step with the main process: loaded when the repository or the
 * closed filter changes, and again whenever the data behind it does.
 */
export function usePullRequestList(repository: string | null): PullRequestListStore {
	const api = useApi();
	const [store] = useState(() => new PullRequestListStore());
	const includeClosed = store.useState("includeClosed");

	useEffect(() => {
		let cancelled = false;
		let latest = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const load = async (): Promise<void> => {
			// Answers can overtake each other; only the newest question's is taken.
			latest += 1;
			const sequence = latest;
			try {
				const rows =
					repository === null ? [] : await api.listPullRequests({ repository, includeClosed });
				if (!cancelled && sequence === latest) {
					store.replaceRows(rows);
				}
			} catch (cause) {
				if (!cancelled && sequence === latest) {
					store.failLoading(message(cause));
				}
			}
		};

		store.startLoading();
		void load();

		// Calls that land within a moment of each other are folded into one load: an assessment run
		// announces a change every time a pull request starts or finishes.
		const stop = api.on("data-changed", (payload) => {
			if (payload.repository === null || payload.repository === repository) {
				clearTimeout(timer);
				timer = setTimeout(() => void load(), RELOAD_DELAY);
			}
		});

		return () => {
			cancelled = true;
			clearTimeout(timer);
			stop();
		};
	}, [api, store, repository, includeClosed]);

	return store;
}
