import { describe, expect, it } from "vitest";
import { columnsFor, DEFAULT_COLUMNS, toggleColumn, visibleColumns } from "./columns.js";

/** The usual case: pull requests, one repository. */
const pulls = { compact: false, kind: "pull_request" as const, allRepositories: false };

describe("visibleColumns", () => {
	it("shows every column of the kind but status by default", () => {
		expect(visibleColumns(DEFAULT_COLUMNS, pulls)).toEqual(
			columnsFor("pull_request", false).filter((column) => column.key !== "status"),
		);
	});

	it("gives each kind its own columns", () => {
		const issues = visibleColumns(DEFAULT_COLUMNS, { ...pulls, kind: "issue" }).map((c) => c.key);
		expect(issues).toContain("comments");
		expect(visibleColumns(DEFAULT_COLUMNS, pulls).map((c) => c.key)).not.toContain("comments");
	});

	it("shows the repository only when the scope is every repository", () => {
		expect(visibleColumns(DEFAULT_COLUMNS, pulls).map((c) => c.key)).not.toContain("repository");
		expect(
			visibleColumns([...DEFAULT_COLUMNS, "repository"], { ...pulls, allRepositories: true }).map(
				(c) => c.key,
			),
		).toContain("repository");
	});

	it("keeps the fixed columns whatever was chosen", () => {
		expect(visibleColumns([], pulls).map((column) => column.key)).toEqual(["number", "title"]);
	});

	it("draws chosen columns in the table's order, not the order they were chosen in", () => {
		expect(visibleColumns(["age", "author"], pulls).map((column) => column.key)).toEqual([
			"number",
			"title",
			"author",
			"age",
		]);
	});

	it("drops the secondary columns while the panel is open", () => {
		const keys = visibleColumns(DEFAULT_COLUMNS, { ...pulls, compact: true }).map(
			(column) => column.key,
		);
		expect(keys).not.toContain("author");
		expect(keys).toContain("nextAction");
	});
});

describe("toggleColumn", () => {
	it("adds a column that is missing and removes one that is present", () => {
		expect(toggleColumn(["age"], "author")).toEqual(["age", "author"]);
		expect(toggleColumn(["age", "author"], "author")).toEqual(["age"]);
	});
});
