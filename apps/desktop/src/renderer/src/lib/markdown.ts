/**
 * The little the app needs to know about Markdown on its own: the rendering is react-markdown's.
 */

/** A heading's anchor: lower-case words joined by hyphens, as GitHub would make it. */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
		.trim()
		.replaceAll(/\s+/g, "-");
}

/** Hands out anchors, with a number appended when the same heading text turns up again. */
export function createSlugger(): (text: string) => string {
	const seen = new Map<string, number>();
	return (text) => {
		const base = slugify(text) || "section";
		const count = seen.get(base) ?? 0;
		seen.set(base, count + 1);
		return count === 0 ? base : `${base}-${String(count)}`;
	};
}

const LEAD_LENGTH = 240;

/**
 * The first paragraph of prose, as plain text, cut to a sentence or two: what the side panel
 * shows of an analysis before the reader decides to open it. Headings, fences and lists are
 * skipped, since the first thing under "Background" is what the reader wants a taste of.
 */
export function leadOf(markdown: string): string {
	const lines = markdown.split("\n");
	let inFence = false;
	let paragraph: string[] = [];

	const finish = (): string | undefined => {
		if (paragraph.length === 0) {
			return undefined;
		}
		const text = plainText(paragraph.join(" "));
		paragraph = [];
		return text || undefined;
	};

	for (const raw of lines) {
		const line = raw.trim();
		if (line.startsWith("```") || line.startsWith("~~~")) {
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			continue;
		}
		const isProse =
			line !== "" &&
			!/^(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||<)/.test(line) &&
			!/^[-*_]{3,}$/.test(line);
		if (isProse) {
			paragraph.push(line);
			continue;
		}
		const found = finish();
		if (found !== undefined) {
			return truncate(found);
		}
	}
	return truncate(finish() ?? "");
}

/** Strips the inline markup a paragraph is likely to carry, leaving its words. */
function plainText(text: string): string {
	return text
		.replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replaceAll(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replaceAll(/`([^`]*)`/g, "$1")
		.replaceAll(/(\*\*|__)(.+?)\1/g, "$2")
		.replaceAll(/(\*|_)(.+?)\1/g, "$2")
		.replaceAll(/\s+/g, " ")
		.trim();
}

function truncate(text: string): string {
	if (text.length <= LEAD_LENGTH) {
		return text;
	}
	const cut = text.slice(0, LEAD_LENGTH);
	const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" "));
	return `${cut.slice(0, end > LEAD_LENGTH / 2 ? end : LEAD_LENGTH).replace(/[.,;:]$/, "")}…`;
}
