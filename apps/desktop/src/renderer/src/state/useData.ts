import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "../api.js";
import type {
	AgentCatalogs,
	Config,
	Job,
	PullRequestDetail,
	PullRequestRow,
	RepositorySummary,
} from "../../../shared/ipc.js";

export interface Loadable<T> {
	value: T | undefined;
	loading: boolean;
	error: string | undefined;
	/**
	 * Loads again, shortly. Calls that land within a moment of each other are folded into one load,
	 * because an assessment run announces a change every time a pull request starts or finishes,
	 * and re-reading the whole table for each of six agents would be what makes the window sluggish.
	 */
	reload: () => void;
}

const RELOAD_DELAY = 150;

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/** Loads once, then again whenever `reload` is called or a dependency changes. */
function useLoadable<T>(load: () => Promise<T>, deps: unknown[]): Loadable<T> {
	const [value, setValue] = useState<T | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	const [loading, setLoading] = useState(true);
	const [nonce, setNonce] = useState(0);

	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

	// eslint-disable-next-line react-hooks/exhaustive-deps -- the caller states the dependencies
	const run = useCallback(load, deps);

	useEffect(() => {
		let cancelled = false;
		setLoading(true);

		const fetchOnce = async (): Promise<void> => {
			try {
				const next = await run();
				if (!cancelled) {
					setValue(next);
					setError(undefined);
				}
			} catch (cause) {
				if (!cancelled) {
					setError(message(cause));
				}
			} finally {
				if (!cancelled) {
					setLoading(false);
				}
			}
		};

		void fetchOnce();
		return () => {
			cancelled = true;
		};
	}, [run, nonce]);

	useEffect(() => () => clearTimeout(timer.current), []);

	const reload = useCallback(() => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => setNonce((n) => n + 1), RELOAD_DELAY);
	}, []);

	return { value, loading, error, reload };
}

export function useRepositories(): Loadable<RepositorySummary[]> {
	const api = useApi();
	const loadable = useLoadable(() => api.listRepositories(), [api]);

	useEffect(() => {
		const stop = [
			api.on("data-changed", loadable.reload),
			api.on("config-changed", loadable.reload),
		];
		return () => {
			for (const off of stop) {
				off();
			}
		};
	}, [api, loadable.reload]);

	return loadable;
}

export function useConfig(): Loadable<Config> {
	const api = useApi();
	const loadable = useLoadable(() => api.getConfig(), [api]);

	useEffect(() => api.on("config-changed", loadable.reload), [api, loadable.reload]);

	return loadable;
}

/** Read once per window; what an agent offers only changes when the agent itself is updated. */
export function useAgentCatalogs(): Loadable<AgentCatalogs> {
	const api = useApi();
	return useLoadable(() => api.listAgentCatalogs(), [api]);
}

export function usePullRequests(
	repository: string | null,
	includeClosed: boolean,
): Loadable<PullRequestRow[]> {
	const api = useApi();
	const loadable = useLoadable(
		() =>
			repository === null
				? Promise.resolve([])
				: api.listPullRequests({ repository, includeClosed }),
		[api, repository, includeClosed],
	);

	useEffect(() => {
		const stop = api.on("data-changed", (payload) => {
			if (payload.repository === null || payload.repository === repository) {
				loadable.reload();
			}
		});
		return stop;
	}, [api, repository, loadable.reload]);

	return loadable;
}

export function usePullRequestDetail(
	repository: string | null,
	number: number | null,
): Loadable<PullRequestDetail> {
	const api = useApi();
	const loadable = useLoadable(
		() =>
			repository === null || number === null
				? Promise.resolve(undefined as unknown as PullRequestDetail)
				: api.getPullRequest({ repository, number }),
		[api, repository, number],
	);

	useEffect(() => {
		const stop = api.on("data-changed", (payload) => {
			if (payload.repository === null || payload.repository === repository) {
				loadable.reload();
			}
		});
		return stop;
	}, [api, repository, loadable.reload]);

	return loadable;
}

/** This session's jobs, newest first, kept in step with the main process's own events. */
export function useJobs(): Job[] {
	const api = useApi();
	const [jobs, setJobs] = useState<Job[]>([]);

	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			const all = await api.listJobs();
			if (!cancelled) {
				setJobs(all);
			}
		};
		void load();

		const stop = api.on("job-changed", (job) => {
			setJobs((current) =>
				current.some((item) => item.id === job.id)
					? current.map((item) => (item.id === job.id ? job : item))
					: [job, ...current],
			);
		});

		return () => {
			cancelled = true;
			stop();
		};
	}, [api]);

	return jobs;
}
