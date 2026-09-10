import { useEffect, useState } from "react";

function readDark(): boolean {
	return document.documentElement.dataset["mode"] === "dark";
}

/**
 * Whether the window is dark right now, for the few things that cannot take their colours from
 * CSS: a diagram rendered to SVG has to be told. Follows `data-mode`, which is what Kumo reads.
 */
export function useIsDark(): boolean {
	const [dark, setDark] = useState(readDark);

	useEffect(() => {
		const observer = new MutationObserver(() => setDark(readDark()));
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-mode"],
		});
		return () => observer.disconnect();
	}, []);

	return dark;
}
