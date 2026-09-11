import { useEffect, useState } from "react";
import type { ItemKind } from "@proctologist/core/browser";
import { useApi } from "../api.js";
import { ItemListStore, parseItemKey } from "./ItemListStore.js";
import { RELOAD_DELAY } from "./useData.js";

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/**
 * The main table's store, kept in step with the main process: the rows are loaded when the
 * repository or the closed filter changes, the detail when the selection does, and both again
 * whenever the data behind them does.
 */
/**
 * `null` is the All scope: every tracked repository in one list. `undefined` is "nothing picked
 * yet", which shows nothing rather than everything.
 */
export function useItemList(
	repository: string | null | undefined,
	kind: ItemKind = "pull_request",
): ItemListStore {
	const api = useApi();
	const [store] = useState(() => new ItemListStore());
	const includeClosed = store.useState("includeClosed");
	const selected = store.useState("selected");

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
					repository === undefined ? [] : await api.listItems({ repository, kind, includeClosed });
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
	}, [api, store, repository, kind, includeClosed]);

	useEffect(() => {
		store.startLoadingDetail(repository === undefined ? null : selected);
		if (repository === undefined || selected === null) {
			return;
		}
		const ref = parseItemKey(selected);
		let cancelled = false;
		let latest = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const load = async (): Promise<void> => {
			latest += 1;
			const sequence = latest;
			try {
				const detail = await api.getItem(ref);
				if (!cancelled && sequence === latest) {
					store.replaceDetail(detail);
				}
			} catch (cause) {
				if (!cancelled && sequence === latest) {
					store.failLoadingDetail(message(cause));
				}
			}
		};

		void load();

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
	}, [api, store, repository, selected]);

	return store;
}
