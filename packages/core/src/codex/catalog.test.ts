import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { effortsFor, parseModelCatalog, type CodexModel } from "./catalog.js";

const here = path.dirname(fileURLToPath(import.meta.url));

let models: CodexModel[];

beforeAll(async () => {
	models = parseModelCatalog(
		await readFile(path.join(here, "__fixtures__", "model-catalog.json"), "utf8"),
	);
});

describe("parseModelCatalog", () => {
	it("reads the models Codex offers", () => {
		expect(models.map((model) => model.slug)).toContain("gpt-6-astra");
		expect(models.find((model) => model.slug === "gpt-6-astra")).toMatchObject({
			displayName: "GPT-6-Astra",
			defaultEffort: "medium",
			listed: true,
		});
	});

	it("marks the models Codex keeps out of its own pickers", () => {
		expect(models.find((model) => model.slug === "gpt-reserve")?.listed).toBe(false);
	});

	it("keeps each model's own reasoning levels, which are not the same everywhere", () => {
		const astra = models.find((model) => model.slug === "gpt-6-astra");
		const older = models.find((model) => model.slug === "gpt-5.5");

		expect(astra?.efforts.map((level) => level.effort)).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
			"ultra",
		]);
		expect(older?.efforts.map((level) => level.effort)).toEqual(["low", "medium", "high", "xhigh"]);
	});

	it("keeps the descriptions Codex gives each level", () => {
		const level = models[0]?.efforts.find((item) => item.effort === "low");

		expect(level?.description).not.toBe("");
	});

	it("copes with a catalog that has grown fields it does not know", () => {
		const parsed = parseModelCatalog(
			JSON.stringify({ models: [{ slug: "future", something_new: true }], extra: 1 }),
		);

		expect(parsed).toEqual([
			{
				slug: "future",
				displayName: "future",
				description: "",
				defaultEffort: "medium",
				efforts: [],
				listed: true,
			},
		]);
	});

	it("skips a model with no slug rather than inventing one", () => {
		expect(parseModelCatalog(JSON.stringify({ models: [{ display_name: "Nameless" }] }))).toEqual(
			[],
		);
	});

	it("returns nothing for an empty catalog", () => {
		expect(parseModelCatalog(JSON.stringify({}))).toEqual([]);
	});
});

describe("effortsFor", () => {
	it("gives the levels of the model it is asked about", () => {
		expect(effortsFor(models, "gpt-5.5").map((level) => level.effort)).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
		]);
	});

	it("gives every level in the catalog when no model is chosen", () => {
		expect(effortsFor(models, undefined).map((level) => level.effort)).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
			"ultra",
		]);
	});

	it("falls back to every level for a model it does not know", () => {
		expect(effortsFor(models, "something-new").length).toBeGreaterThan(0);
	});
});
