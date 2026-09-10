import { describe, expect, it } from "vitest";
import { createSlugger, leadOf, slugify } from "./markdown.js";

describe("slugify", () => {
	it("makes GitHub-style anchors", () => {
		expect(slugify("Points of attention")).toBe("points-of-attention");
		expect(slugify("  The `value` prop, revisited ")).toBe("the-value-prop-revisited");
	});

	it("numbers a heading that repeats", () => {
		const slug = createSlugger();
		expect(slug("Before")).toBe("before");
		expect(slug("Before")).toBe("before-1");
		expect(slug("###")).toBe("section");
	});
});

describe("leadOf", () => {
	it("takes the first paragraph of prose, skipping headings, fences and lists", () => {
		const markdown = [
			"## Background",
			"",
			"```mermaid",
			"flowchart LR",
			"  A --> B",
			"```",
			"",
			"- not this",
			"",
			"The **select** keeps its `value` as a [string](https://example.test).",
			"It changes in this pull request.",
			"",
			"Another paragraph.",
		].join("\n");

		expect(leadOf(markdown)).toBe(
			"The select keeps its value as a string. It changes in this pull request.",
		);
	});

	it("cuts a long paragraph at a sentence or a word", () => {
		const sentence = "This sentence is exactly long enough to matter. ";
		const lead = leadOf(sentence.repeat(10));

		expect(lead.length).toBeLessThanOrEqual(241);
		expect(lead.endsWith("…")).toBe(true);
		expect(lead).not.toContain("..");
	});

	it("is empty for an analysis with no prose", () => {
		expect(leadOf("## Heading\n\n```\ncode\n```\n")).toBe("");
	});
});
