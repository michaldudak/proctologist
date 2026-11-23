import type { GitHubClient, IssueBundle, PullRequestBundle } from "../github/client.js";
import { StoreError, type ItemFacts } from "../store/types.js";
import type { SourceProvider, ExternalItemRef } from "./provider.js";

export function githubNumber(ref: ExternalItemRef): number {
	const number = Number(ref.externalId);
	if (!["pull_request", "issue"].includes(ref.kind) || !Number.isSafeInteger(number) || number < 1)
		throw new StoreError("Invalid GitHub Item identity.");
	return number;
}
export function createGitHubProvider(
	github: GitHubClient,
): SourceProvider<ItemFacts, IssueBundle | PullRequestBundle> {
	return {
		listOpen: async (source, kinds, options = {}) =>
			(
				await Promise.all(
					kinds.map((kind) => {
						if (kind === "pull_request")
							return github.listOpenPullRequests(source.locator, options);
						if (kind === "issue") return github.listOpenIssues(source.locator, options);
						throw new StoreError("Unknown GitHub Item kind.");
					}),
				)
			).flat(),
		readState: (source, ref, options = {}) =>
			github.itemState(
				source.locator,
				ref.kind === "issue" ? "issue" : "pull_request",
				githubNumber(ref),
				options,
			),
		context: (source, ref, options = {}) =>
			ref.kind === "issue"
				? github.issueBundle(source.locator, githubNumber(ref), options)
				: github.pullRequestBundle(source.locator, githubNumber(ref), options),
	};
}
