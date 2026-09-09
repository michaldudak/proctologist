import { useCallback, useEffect, useState } from "react";
import { useApi } from "../api.js";
import type {
	CodexCatalog,
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
	reload: () => void;
}

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/** Loads once, then again whenever `reload` is called or a dependency changes. */
function useLoadable<T>(load: () => Promise<T>, deps: unknown[]): Loadable<T> {
	const [value, setValue] = useState<T | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	const [loading, setLoading] = useState(true);
	const [nonce, setNonce] = useState(0);

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

	return { value, loading, error, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useRepositories(): Loadable<RepositorySummary[]> {
	const api = useApi();
	const loadable = useLoadable(() => api.listRepositories(), [api]);

	useEffect(() => {
		const stop = [
			api.on("data-changed", loadable.reload),
			api.on("job-changed", loadable.reload),
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

/** Read once per window; the models only change when Codex itself is updated. */
export function useCodexModels(): Loadable<CodexCatalog> {
	const api = useApi();
	return useLoadable(() => api.listCodexModels(), [api]);
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

/** Queued and running jobs, kept in step with the main process's own events. */
export function useJobs(): Job[] {
	const api = useApi();
	const [jobs, setJobs] = useState<Job[]>([]);

	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			const all = await api.listJobs();
			if (!cancelled) {
				setJobs(all.filter(isActive));
			}
		};
		void load();

		const stop = api.on("job-changed", (job) => {
			setJobs((current) => {
				const others = current.filter((item) => item.id !== job.id);
				return isActive(job) ? [...others, job] : others;
			});
		});

		return () => {
			cancelled = true;
			stop();
		};
	}, [api]);

	return jobs;
}

function isActive(job: Job): boolean {
	return job.state === "queued" || job.state === "running";
}
