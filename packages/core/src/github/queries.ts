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
	authorAssociation
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

/**
 * An issue's facts. `lastEditedAt` and the last few comments are what `changedAt` is computed from:
 * an issue's own `updatedAt` moves for a label or a reaction, which no judgment depends on. The
 * comments are fetched with their authors so a bot's can be told from a person's.
 */
const ISSUE_FACTS = `
	number
	title
	url
	createdAt
	updatedAt
	lastEditedAt
	stateReason
	author { __typename login }
	authorAssociation
	labels(first: 30) { nodes { name } }
	assignees(first: 10) { nodes { login } }
	milestone { title }
	reactionGroups { content reactors { totalCount } }
	comments(last: 10) {
		totalCount
		nodes { createdAt author { __typename login } }
	}
	timelineItems(last: 10, itemTypes: [REOPENED_EVENT, CLOSED_EVENT, CROSS_REFERENCED_EVENT]) {
		nodes {
			__typename
			... on ReopenedEvent { createdAt }
			... on ClosedEvent { createdAt }
			... on CrossReferencedEvent {
				source { __typename ... on PullRequest { number } }
			}
		}
	}
`;

export const OPEN_ISSUES_QUERY = `
query OpenIssues($owner: String!, $name: String!, $cursor: String, $pageSize: Int!) {
	repository(owner: $owner, name: $name) {
		issues(
			states: OPEN
			first: $pageSize
			after: $cursor
			orderBy: { field: UPDATED_AT, direction: DESC }
		) {
			pageInfo { hasNextPage endCursor }
			nodes {
${ISSUE_FACTS}
			}
		}
	}
}
`;

export const ISSUE_BUNDLE_QUERY = `
query IssueBundle($owner: String!, $name: String!, $number: Int!) {
	repository(owner: $owner, name: $name) {
		issue(number: $number) {
${ISSUE_FACTS}
			body
			firstComments: comments(first: 3) {
				nodes { createdAt author { __typename login } authorAssociation body }
			}
			lastComments: comments(last: 7) {
				nodes { createdAt author { __typename login } authorAssociation body }
			}
		}
	}
}
`;
