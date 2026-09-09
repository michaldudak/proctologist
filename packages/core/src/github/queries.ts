/** GraphQL documents. Both are read-only queries; the app never sends a mutation. */

const PULL_REQUEST_FACTS = `
	number
	title
	url
	isDraft
	createdAt
	updatedAt
	headRefOid
	baseRefName
	additions
	deletions
	changedFiles
	mergeable
	reviewDecision
	author { __typename login }
	labels(first: 30) { nodes { name } }
	reviewRequests(first: 30) {
		nodes {
			requestedReviewer {
				__typename
				... on User { login }
				... on Team { name }
			}
		}
	}
	comments(last: 1) { nodes { createdAt author { login } } }
	reviews(last: 1) { nodes { submittedAt author { login } } }
	commits(last: 1) {
		nodes {
			commit {
				committedDate
				author { user { login } }
				statusCheckRollup {
					contexts(first: 100) {
						nodes {
							__typename
							... on CheckRun { status conclusion }
							... on StatusContext { state }
						}
					}
				}
			}
		}
	}
`;

export const OPEN_PULL_REQUESTS_QUERY = `
query OpenPullRequests($owner: String!, $name: String!, $cursor: String, $pageSize: Int!) {
	repository(owner: $owner, name: $name) {
		defaultBranchRef { name }
		pullRequests(
			states: OPEN
			first: $pageSize
			after: $cursor
			orderBy: { field: UPDATED_AT, direction: DESC }
		) {
			pageInfo { hasNextPage endCursor }
			nodes {
${PULL_REQUEST_FACTS}
			}
		}
	}
}
`;

export const PULL_REQUEST_BUNDLE_QUERY = `
query PullRequestBundle($owner: String!, $name: String!, $number: Int!) {
	repository(owner: $owner, name: $name) {
		defaultBranchRef { name }
		pullRequest(number: $number) {
${PULL_REQUEST_FACTS}
			body
			# Aliased: the fragment above already selects comments and reviews with other arguments.
			discussion: comments(first: 100) { nodes { createdAt body author { login } } }
			submittedReviews: reviews(first: 50) { nodes { submittedAt state body author { login } } }
			reviewThreads(first: 50) {
				nodes {
					isResolved
					isOutdated
					path
					comments(first: 20) { nodes { createdAt body author { login } } }
				}
			}
			files(first: 100) { totalCount nodes { path additions deletions } }
		}
	}
}
`;

export const DEFAULT_BRANCH_QUERY = `
query DefaultBranch($owner: String!, $name: String!) {
	repository(owner: $owner, name: $name) { defaultBranchRef { name } }
}
`;
