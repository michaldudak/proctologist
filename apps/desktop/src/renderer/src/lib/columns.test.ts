import { describe, expect, it } from "vitest";
import { COLUMNS, DEFAULT_COLUMNS, toggleColumn, visibleColumns } from "./columns.js";

describe("visibleColumns", () => {
	it("shows every column but status by default", () => {
		expect(visibleColumns(DEFAULT_COLUMNS, false)).toEqual(
			COLUMNS.filter((column) => column.key !== "status"),
		);
	});

	it("keeps the fixed columns whatever was chosen", () => {
		expect(visibleColumns([], false).map((column) => column.key)).toEqual(["number", "title"]);
	});

	it("draws chosen columns in the table's order, not the order they were chosen in", () => {
		expect(visibleColumns(["age", "author"], false).map((column) => column.key)).toEqual([
			"number",
			"title",
			"author",
			"age",
		]);
	});

	it("drops the secondary columns while the panel is open", () => {
		const keys = visibleColumns(DEFAULT_COLUMNS, true).map((column) => column.key);
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
