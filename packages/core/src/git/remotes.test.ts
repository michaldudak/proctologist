import { describe, expect, it } from "vitest";
import { repositoryFromRemoteUrl } from "./remotes.js";

describe("repositoryFromRemoteUrl", () => {
	it.each([
		["git@github.com:owner/thing.git", "owner/thing"],
		["git@github.com:owner/thing", "owner/thing"],
		["ssh://git@github.com/owner/thing.git", "owner/thing"],
		["https://github.com/owner/thing.git", "owner/thing"],
		["https://github.com/owner/thing", "owner/thing"],
		["https://user@github.example.com/owner/thing.git", "owner/thing"],
		["/local/path/owner/thing.git", "owner/thing"],
	])("reads %s as %s", (url, expected) => {
		expect(repositoryFromRemoteUrl(url)).toBe(expected);
	});

	it("returns nothing for a URL without two segments", () => {
		expect(repositoryFromRemoteUrl("https://github.com/")).toBeUndefined();
	});
});
