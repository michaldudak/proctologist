import { isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { createSlugger } from "../lib/markdown.js";
import { Mermaid } from "./Mermaid.js";

interface MarkdownProps {
	markdown: string;
	/** Links open outside the app; the window is not a browser. */
	onOpenLink: (url: string) => void;
}

const PLUGINS = [remarkGfm];

/**
 * Agent-written Markdown, rendered. Raw HTML in it is dropped rather than trusted, Mermaid fences
 * become diagrams, and headings get anchors so a table of contents can point at them.
 */
export function Markdown({ markdown, onOpenLink }: MarkdownProps): React.JSX.Element {
	// One slugger per render: the anchors have to be the same ones the outline finds in the DOM.
	const slug = createSlugger();

	const heading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
		function Heading({ children }: { children?: ReactNode }): React.JSX.Element {
			return <Tag id={slug(textOf(children))}>{children}</Tag>;
		};

	const components: Components = {
		h1: heading("h1"),
		h2: heading("h2"),
		h3: heading("h3"),
		h4: heading("h4"),
		h5: heading("h5"),
		h6: heading("h6"),
		a: ({ href, children }) => (
			<a
				href={href}
				onClick={(event) => {
					event.preventDefault();
					if (href !== undefined) {
						onOpenLink(href);
					}
				}}
			>
				{children}
			</a>
		),
		pre: ({ children }) => {
			const source = mermaidSourceOf(children);
			return source === undefined ? <pre>{children}</pre> : <Mermaid source={source} />;
		},
	};

	return (
		<ReactMarkdown remarkPlugins={PLUGINS} components={components} skipHtml>
			{markdown}
		</ReactMarkdown>
	);
}

/** The text of a ```mermaid fence, when that is what the `pre` wraps. */
function mermaidSourceOf(children: ReactNode): string | undefined {
	if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) {
		return undefined;
	}
	const { className, children: code } = children.props;
	if (!className?.split(" ").includes("language-mermaid")) {
		return undefined;
	}
	return textOf(code).trim();
}

function textOf(node: ReactNode): string {
	if (node === null || node === undefined || typeof node === "boolean") {
		return "";
	}
	if (typeof node === "string" || typeof node === "number") {
		return String(node);
	}
	if (Array.isArray(node)) {
		return node.map(textOf).join("");
	}
	if (isValidElement<{ children?: ReactNode }>(node)) {
		return textOf(node.props.children);
	}
	return "";
}
