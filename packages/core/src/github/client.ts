import type { IssueFacts, PullRequestFacts } from "../store/types.js";
import { GitHubError, runGh, runGhJson, type GhOptions } from "./gh.js";
import { isBot, toIssueFacts, toPullRequestFacts } from "./map.js";
import {
	ISSUE_BUNDLE_QUERY,
	OPEN_ISSUES_QUERY,
	DEFAULT_BRANCH_QUERY,
	OPEN_PULL_REQUESTS_QUERY,
	PULL_REQUEST_BUNDLE_QUERY,
} from "./queries.js";
import type {
	IssueBundleResponse,
	OpenIssuesResponse,
	DefaultBranchResponse,
	OpenPullRequestsResponse,
	PullRequestBundleResponse,
} from "./schema.js";

export interface Viewer {
	login: string;
}

export interface BundleComment {
	author: string | null;
	createdAt: string;
	body: string;
}

export interface BundleReview {
	author: string | null;
	state: string;
	submittedAt: string | null;
	body: string;
}

export interface BundleReviewThread {
	path: string | null;
	isResolved: boolean;
	isOutdated: boolean;
	comments: BundleComment[];
}

export interface BundleFile {
	path: string;
	additions: number;
	deletions: number;
}

/** Everything the agent is shown about one pull request. */
export interface PullRequestBundle {
	facts: PullRequestFacts;
	body: string;
	comments: BundleComment[];
	reviews: BundleReview[];
	reviewThreads: BundleReviewThread[];
	files: BundleFile[];
	/** True when the pull request touches more files than one page holds. */
	filesTruncated: boolean;
	/** Null when the diff was left out; `diffOmittedReason` then says why. */
	diff: string | null;
	diffOmittedReason: string | null;
}

export interface BundleOptions {
	/** Diffs larger than this are left out and the file list stands in for them. */
	diffCutoffKb?: number;
	signal?: AbortSignal;
}

export interface ListOptions {
	signal?: AbortSignal;
}

/**
 * Everything a triage prompt is handed about one issue. Ten comments — the first three and the last
 * seven — because the front of a thread says whether anyone ever confirmed the report and the back
 * says where it stands, while the middle is mostly agreement. `commentsTotal` tells the agent what
 * it was not given, so it can go and fetch the rest when the ten do not explain the state.
 */
export interface IssueBundle {
	facts: IssueFacts;
	body: string;
	comments: IssueComment[];
	commentsTotal: number;
}

export interface IssueComment {
	createdAt: string;
	author: string;
	authorAssociation: string;
	body: string;
	isBot: boolean;
}

export interface GitHubClient {
	/** The account `gh` is authenticated as. Cached for the life of the client. */
	viewer: () => Promise<Viewer>;
	defaultBranch: (repository: string) => Promise<string>;
	listOpenPullRequests: (repository: string, options?: ListOptions) => Promise<PullRequestFacts[]>;
	pullRequestBundle: (
		repository: string,
		number: number,
		options?: BundleOptions,
	) => Promise<PullRequestBundle>;
	listOpenIssues: (repository: string, options?: ListOptions) => Promise<IssueFacts[]>;
	issueBundle: (repository: string, number: number, options?: ListOptions) => Promise<IssueBundle>;
}

export interface GitHubClientOptions extends GhOptions {
	/** Pull requests fetched per GraphQL page. */
	pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 50;
const DEFAULT_DIFF_CUTOFF_KB = 60;

export function createGitHubClient(options: GitHubClientOptions = {}): GitHubClient {
	const gh: GhOptions = { ghPath: options.ghPath, env: options.env, cwd: options.cwd };
	const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
	let viewerPromise: Promise<Viewer> | undefined;

	async function graphql<T>(
		query: string,
		variables: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<T> {
		return runGhJson<T>(["api", "graphql", "--input", "-"], {
			...gh,
			input: JSON.stringify({ query, variables }),
			signal,
		});
	}

	const viewer = (): Promise<Viewer> => {
		viewerPromise ??= runGhJson<{ login: string }>(["api", "user"], gh).then((user) => ({
			login: user.login,
		}));
		return viewerPromise;
	};

	return {
		viewer,
		defaultBranch: async (repository) => {
			const { owner, name } = parseRepository(repository);
			const response = await graphql<DefaultBranchResponse>(DEFAULT_BRANCH_QUERY, {
				owner,
				name,
			});
			const branch = requireRepository(response.data.repository, repository).defaultBranchRef?.name;
			if (!branch) {
				throw new GitHubError("not_found", `${repository} has no default branch yet.`);
			}
			return branch;
		},
		listOpenPullRequests: async (repository, listOptions = {}) => {
			const { owner, name } = parseRepository(repository);
			const { login } = await viewer();
			const facts: PullRequestFacts[] = [];
			let cursor: string | null = null;

			for (;;) {
				// Cursors are handed out one page at a time, so these requests cannot be parallelised.
				// oxlint-disable-next-line no-await-in-loop
				const response: OpenPullRequestsResponse = await graphql<OpenPullRequestsResponse>(
					OPEN_PULL_REQUESTS_QUERY,
					{ owner, name, cursor, pageSize },
					listOptions.signal,
				);
				const page = requireRepository(response.data.repository, repository).pullRequests;

				for (const node of page.nodes ?? []) {
					if (node) {
						facts.push(toPullRequestFacts(node, { repository, viewerLogin: login }));
					}
				}

				if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) {
					return facts;
				}
				cursor = page.pageInfo.endCursor;
			}
		},
		listOpenIssues: async (repository, listOptions = {}) => {
			const { owner, name } = parseRepository(repository);
			const { login } = await viewer();
			const facts: IssueFacts[] = [];
			let cursor: string | null = null;

			for (;;) {
				// Cursors are handed out one page at a time, so these requests cannot be parallelised.
				// oxlint-disable-next-line no-await-in-loop
				const response: OpenIssuesResponse = await graphql<OpenIssuesResponse>(
					OPEN_ISSUES_QUERY,
					{ owner, name, cursor, pageSize },
					listOptions.signal,
				);
				const page = requireRepository(response.data.repository, repository).issues;

				for (const node of page.nodes ?? []) {
					if (node) {
						facts.push(toIssueFacts(node, { repository, viewerLogin: login }));
					}
				}

				if (!page.pageInfo.hasNextPage || page.pageInfo.endCursor === null) {
					return facts;
				}
				cursor = page.pageInfo.endCursor;
			}
		},
		issueBundle: async (repository, number, listOptions = {}) => {
			const { owner, name } = parseRepository(repository);
			const { login } = await viewer();
			const response = await graphql<IssueBundleResponse>(
				ISSUE_BUNDLE_QUERY,
				{ owner, name, number },
				listOptions.signal,
			);
			const node = requireRepository(response.data.repository, repository).issue;
			if (!node) {
				throw new GitHubError("not_found", `${repository}#${String(number)} is not an issue.`);
			}

			const total = node.comments?.totalCount ?? 0;
			const first = (node.firstComments?.nodes ?? []).filter((comment) => comment !== null);
			const last = (node.lastComments?.nodes ?? []).filter((comment) => comment !== null);
			// The two windows overlap on a short thread, so the later one wins by timestamp.
			const seen = new Map<string, IssueComment>();
			for (const comment of [...first, ...last]) {
				seen.set(comment.createdAt + (comment.author?.login ?? ""), {
					createdAt: comment.createdAt,
					author: comment.author?.login ?? "ghost",
					authorAssociation: comment.authorAssociation ?? "NONE",
					body: comment.body ?? "",
					isBot: isBot(comment.author),
				});
			}

			return {
				facts: toIssueFacts(node, { repository, viewerLogin: login }),
				body: node.body ?? "",
				comments: [...seen.values()].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
				commentsTotal: total,
			};
		},
		pullRequestBundle: async (repository, number, bundleOptions = {}) => {
			const { owner, name } = parseRepository(repository);
			const { login } = await viewer();
			const response = await graphql<PullRequestBundleResponse>(
				PULL_REQUEST_BUNDLE_QUERY,
				{ owner, name, number },
				bundleOptions.signal,
			);
			const node = requireRepository(response.data.repository, repository).pullRequest;
			if (!node) {
				throw new GitHubError("not_found", `${repository}#${String(number)} does not exist.`);
			}

			const cutoffBytes = (bundleOptions.diffCutoffKb ?? DEFAULT_DIFF_CUTOFF_KB) * 1024;
			const diff = await fetchDiff(gh, repository, number, cutoffBytes, bundleOptions.signal);

			return {
				facts: toPullRequestFacts(node, { repository, viewerLogin: login }),
				body: node.body,
				comments: (node.discussion?.nodes ?? []).flatMap((comment) =>
					comment
						? [
								{
									author: comment.author?.login ?? null,
									createdAt: comment.createdAt,
									body: comment.body,
								},
							]
						: [],
				),
				reviews: (node.submittedReviews?.nodes ?? []).flatMap((review) =>
					review
						? [
								{
									author: review.author?.login ?? null,
									state: review.state,
									submittedAt: review.submittedAt,
									body: review.body,
								},
							]
						: [],
				),
				reviewThreads: (node.reviewThreads?.nodes ?? []).flatMap((thread) =>
					thread
						? [
								{
									path: thread.path,
									isResolved: thread.isResolved,
									isOutdated: thread.isOutdated,
									comments: (thread.comments?.nodes ?? []).flatMap((comment) =>
										comment
											? [
													{
														author: comment.author?.login ?? null,
														createdAt: comment.createdAt,
														body: comment.body,
													},
												]
											: [],
									),
								},
							]
						: [],
				),
				files: (node.files?.nodes ?? []).flatMap((file) => (file ? [file] : [])),
				filesTruncated: (node.files?.totalCount ?? 0) > (node.files?.nodes?.length ?? 0),
				...diff,
			};
		},
	};
}

/**
 * Fetches the raw diff and drops it when it is over the cut-off. Measuring after the download is
 * deliberate: GitHub reports no diff size up front, and the file list is a poor predictor of it.
 */
async function fetchDiff(
	gh: GhOptions,
	repository: string,
	number: number,
	cutoffBytes: number,
	signal?: AbortSignal,
): Promise<{ diff: string | null; diffOmittedReason: string | null }> {
	let diff: string;
	try {
		const result = await runGh(
			[
				"api",
				"-H",
				"Accept: application/vnd.github.v3.diff",
				`repos/${repository}/pulls/${String(number)}`,
			],
			{ ...gh, signal },
		);
		diff = result.stdout;
	} catch (cause) {
		if (cause instanceof GitHubError && cause.kind === "failed") {
			return { diff: null, diffOmittedReason: `The diff could not be fetched: ${cause.message}` };
		}
		throw cause;
	}

	const bytes = Buffer.byteLength(diff, "utf8");
	if (bytes > cutoffBytes) {
		return {
			diff: null,
			diffOmittedReason: `The diff is ${String(Math.round(bytes / 1024))} kB, over the ${String(
				Math.round(cutoffBytes / 1024),
			)} kB cut-off; see the file list instead.`,
		};
	}

	return { diff, diffOmittedReason: null };
}

export function parseRepository(repository: string): { owner: string; name: string } {
	const [owner, name, ...rest] = repository.split("/");
	if (!owner || !name || rest.length > 0) {
		throw new GitHubError(
			"failed",
			`"${repository}" is not a repository name; write it as owner/name.`,
		);
	}
	return { owner, name };
}

function requireRepository<T>(repository: T | null, name: string): T {
	if (repository === null) {
		throw new GitHubError("not_found", `${name} does not exist, or you cannot see it.`);
	}
	return repository;
}
