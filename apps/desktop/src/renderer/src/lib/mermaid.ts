/**
 * Mermaid is loaded on first use: it is the largest thing in the bundle by far, and most sessions
 * never open an analysis. The theme follows the window, built from Kumo's own tokens so a diagram
 * sits in the page rather than on it.
 */

type Mermaid = typeof import("mermaid").default;

let loading: Promise<Mermaid> | undefined;
let configuredFor: string | undefined;
let counter = 0;

async function load(): Promise<Mermaid> {
	loading ??= import("mermaid").then((module) => module.default);
	return loading;
}

/** A theme keyed by what it was built from, so a change of appearance re-initialises. */
function themeKey(dark: boolean): string {
	return dark ? "dark" : "light";
}

/**
 * Mermaid's theme engine reads hex and rgb and nothing newer, while Kumo's tokens are oklch and
 * some are translucent. Painting each one onto a canvas over the page's base colour and reading
 * the pixel back gives an opaque hex whatever the notation. Undefined when the token is missing
 * or the browser could not paint it.
 */
function resolveToken(name: string, over?: string): string | undefined {
	const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
	if (value === "") {
		return undefined;
	}
	const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
	if (!context) {
		return undefined;
	}
	// The setter ignores a value it cannot parse, so a sentinel first tells the two cases apart.
	context.fillStyle = SENTINEL;
	context.fillStyle = value;
	if (context.fillStyle === SENTINEL) {
		return undefined;
	}
	if (over !== undefined) {
		context.fillStyle = over;
		context.fillRect(0, 0, 1, 1);
		context.fillStyle = value;
	}
	context.fillRect(0, 0, 1, 1);
	const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hex(channel: number): string {
	return channel.toString(16).padStart(2, "0");
}

const SENTINEL = "#010203";

/**
 * Kumo's tokens as Mermaid's variables. Null when any token could not be read, in which case the
 * built-in theme for the appearance is the fallback: a diagram in the wrong palette beats none.
 */
function themeVariables(dark: boolean): Record<string, unknown> | null {
	const wanted = {
		background: "--color-kumo-base",
		primaryColor: "--color-kumo-tint",
		primaryTextColor: "--text-color-kumo-strong",
		primaryBorderColor: "--color-kumo-line",
		secondaryColor: "--color-kumo-fill",
		secondaryTextColor: "--text-color-kumo-default",
		secondaryBorderColor: "--color-kumo-line",
		tertiaryColor: "--color-kumo-canvas",
		tertiaryTextColor: "--text-color-kumo-default",
		tertiaryBorderColor: "--color-kumo-hairline",
		lineColor: "--text-color-kumo-subtle",
		textColor: "--text-color-kumo-default",
		noteBkgColor: "--color-kumo-fill",
		noteTextColor: "--text-color-kumo-default",
		noteBorderColor: "--color-kumo-line",
	};
	const base = resolveToken("--color-kumo-base");
	if (base === undefined) {
		return null;
	}
	const variables: Record<string, unknown> = { darkMode: dark, fontSize: "13px" };
	for (const [variable, token] of Object.entries(wanted)) {
		const colour = resolveToken(token, base);
		if (colour === undefined) {
			return null;
		}
		variables[variable] = colour;
	}
	return variables;
}

function configure(mermaid: Mermaid, dark: boolean): void {
	const key = themeKey(dark);
	if (configuredFor === key) {
		return;
	}
	configuredFor = key;
	const variables = themeVariables(dark);
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		fontFamily: "inherit",
		...(variables
			? { theme: "base", themeVariables: variables }
			: { theme: dark ? "dark" : "neutral" }),
	});
}

/** Renders one diagram to SVG markup. Throws with Mermaid's own message when the source is wrong. */
export async function renderDiagram(source: string, dark: boolean): Promise<string> {
	const mermaid = await load();
	configure(mermaid, dark);
	counter += 1;
	const { svg } = await mermaid.render(`analysis-diagram-${String(counter)}`, source);
	return svg;
}
