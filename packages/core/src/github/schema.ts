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
	/** GitHub's raw value, for example `MEMBER` or `FIRST_TIME_CONTRIBUTOR`. */
	authorAssociation: string;
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

export interface IssueCommentNode {
	createdAt: string;
	author: GraphQlActor | null;
	authorAssociation?: string;
	body?: string;
}

export interface IssueFactsNode {
	number: number;
	title: string;
	url: string;
	createdAt: string;
	updatedAt: string;
	/** Null unless the body has been edited; part of what `changedAt` is computed from. */
	lastEditedAt: string | null;
	/** `COMPLETED`, `NOT_PLANNED` or `DUPLICATE`; null while the issue is open. */
	stateReason: string | null;
	author: GraphQlActor | null;
	authorAssociation: string;
	labels: { nodes: { name: string }[] | null } | null;
	assignees: { nodes: ({ login: string } | null)[] | null } | null;
	milestone: { title: string } | null;
	/** All eight reactions; `THUMBS_UP` and `THUMBS_DOWN` are the two that read as votes. */
	reactionGroups: { content: string; reactors: { totalCount: number } | null }[] | null;
	comments: { totalCount: number; nodes: (IssueCommentNode | null)[] | null } | null;
	timelineItems: {
		nodes:
			| ({
					__typename: string;
					createdAt?: string;
					source?: { __typename: string; number?: number } | null;
			  } | null)[]
			| null;
	} | null;
}

export interface IssueBundleNode extends IssueFactsNode {
	body: string | null;
	firstComments: { nodes: (IssueCommentNode | null)[] | null } | null;
	lastComments: { nodes: (IssueCommentNode | null)[] | null } | null;
}

export interface OpenIssuesResponse {
	data: {
		repository: {
			issues: {
				pageInfo: { hasNextPage: boolean; endCursor: string | null };
				nodes: (IssueFactsNode | null)[] | null;
			};
		} | null;
	};
}

export interface IssueBundleResponse {
	data: { repository: { issue: IssueBundleNode | null } | null };
}
