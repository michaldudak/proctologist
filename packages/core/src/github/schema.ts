/** The shapes the GraphQL documents in `queries.ts` return. */

export interface GraphQlActor {
	__typename?: string;
	login: string | null;
}

export interface CheckContextNode {
	__typename: string;
	status?: string | null;
	conclusion?: string | null;
	state?: string | null;
}

export interface PullRequestFactsNode {
	number: number;
	title: string;
	url: string;
	isDraft: boolean;
	createdAt: string;
	updatedAt: string;
	headRefOid: string;
	baseRefName: string;
	additions: number;
	deletions: number;
	changedFiles: number;
	mergeable: string | null;
	reviewDecision: string | null;
	author: GraphQlActor | null;
	labels: { nodes: { name: string }[] | null } | null;
	reviewRequests: {
		nodes:
			| ({
					requestedReviewer: { __typename: string; login?: string; name?: string } | null;
			  } | null)[]
			| null;
	} | null;
	comments: { nodes: ({ createdAt: string; author: GraphQlActor | null } | null)[] | null } | null;
	reviews: {
		nodes: ({ submittedAt: string | null; author: GraphQlActor | null } | null)[] | null;
	} | null;
	commits: {
		nodes:
			| ({
					commit: {
						committedDate: string;
						author: { user: GraphQlActor | null } | null;
						statusCheckRollup: { contexts: { nodes: (CheckContextNode | null)[] | null } } | null;
					};
			  } | null)[]
			| null;
	} | null;
}

export interface BundleNode extends PullRequestFactsNode {
	body: string;
	/** Aliased in the query: the facts fragment already selects `comments` and `reviews`. */
	discussion: {
		nodes: ({ createdAt: string; body: string; author: GraphQlActor | null } | null)[] | null;
	} | null;
	submittedReviews: {
		nodes:
			| ({
					submittedAt: string | null;
					state: string;
					body: string;
					author: GraphQlActor | null;
			  } | null)[]
			| null;
	} | null;
	reviewThreads: {
		nodes:
			| ({
					isResolved: boolean;
					isOutdated: boolean;
					path: string | null;
					comments: {
						nodes:
							({ createdAt: string; body: string; author: GraphQlActor | null } | null)[] | null;
					} | null;
			  } | null)[]
			| null;
	} | null;
	files: {
		totalCount: number;
		nodes: ({ path: string; additions: number; deletions: number } | null)[] | null;
	} | null;
}

export interface OpenPullRequestsResponse {
	data: {
		repository: {
			defaultBranchRef: { name: string } | null;
			pullRequests: {
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
				nodes: (PullRequestFactsNode | null)[] | null;
			};
		} | null;
	};
}

export interface PullRequestBundleResponse {
	data: {
		repository: {
			defaultBranchRef: { name: string } | null;
			pullRequest: BundleNode | null;
		} | null;
	};
}

export interface DefaultBranchResponse {
	data: { repository: { defaultBranchRef: { name: string } | null } | null };
}
