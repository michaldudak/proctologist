import { describe, expect, it } from "vitest";
import { toIssueFacts } from "./map.js";
import type { IssueFactsNode } from "./schema.js";

const NOW = "2026-09-01T00:00:00Z";

/** The shape GitHub actually returns: all eight groups, whether or not anyone reacted. */
function node(overrides: Partial<IssueFactsNode> = {}): IssueFactsNode {
	return {
		number: 2200,
		title: "[discussion] Base UI Integration with SolidJS?",
		url: "https://github.com/mui/base-ui/issues/2200",
		createdAt: NOW,
		updatedAt: NOW,
		lastEditedAt: null,
		stateReason: null,
		author: { __typename: "User", login: "someone" },
		authorAssociation: "NONE",
		labels: null,
		assignees: null,
		milestone: null,
		reactionGroups: [
			{ content: "THUMBS_UP", reactors: { totalCount: 84 } },
			{ content: "THUMBS_DOWN", reactors: { totalCount: 2 } },
			{ content: "LAUGH", reactors: { totalCount: 0 } },
			{ content: "HOORAY", reactors: { totalCount: 7 } },
			{ content: "CONFUSED", reactors: { totalCount: 0 } },
			{ content: "HEART", reactors: { totalCount: 9 } },
			{ content: "ROCKET", reactors: { totalCount: 0 } },
			{ content: "EYES", reactors: { totalCount: 3 } },
		],
		comments: null,
		timelineItems: null,
		...overrides,
	};
}

describe("toIssueFacts votes", () => {
	it("takes the two thumbs and leaves the other six alone", () => {
		const facts = toIssueFacts(node(), { repository: "mui/base-ui", viewerLogin: "michaldudak" });

		expect(facts.upvotes).toBe(84);
		expect(facts.downvotes).toBe(2);
	});

	it("reads no reactions as none rather than as missing", () => {
		const facts = toIssueFacts(node({ reactionGroups: [] }), {
			repository: "mui/base-ui",
			viewerLogin: "michaldudak",
		});

		expect(facts.upvotes).toBe(0);
		expect(facts.downvotes).toBe(0);
	});

	it("survives GitHub leaving the groups out entirely", () => {
		const facts = toIssueFacts(node({ reactionGroups: null }), {
			repository: "mui/base-ui",
			viewerLogin: "michaldudak",
		});

		expect(facts.upvotes).toBe(0);
	});
});
