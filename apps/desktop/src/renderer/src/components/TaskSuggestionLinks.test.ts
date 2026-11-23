import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { TaskSuggestionLinks } from "./TaskSuggestionLinks.js";
it("exposes a repair action for links whose Source is no longer available", () => {
	const html = renderToStaticMarkup(
		createElement(TaskSuggestionLinks, {
			items: [],
			itemIds: ["removed-item"],
			onChange: () => {},
		}),
	);
	expect(html).toContain("Remove missing links");
	expect(html).toContain("no longer in a tracked source");
});
