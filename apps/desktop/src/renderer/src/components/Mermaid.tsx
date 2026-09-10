import { useEffect, useState } from "react";
import { renderDiagram } from "../lib/mermaid.js";
import { useIsDark } from "../state/useIsDark.js";

interface MermaidProps {
	source: string;
}

type DiagramState =
	{ kind: "rendering" } | { kind: "rendered"; svg: string } | { kind: "failed"; message: string };

/**
 * One diagram from a Mermaid fence. A diagram the agent got wrong is shown as its source with the
 * error under it, rather than as nothing: the reader can still make sense of a flowchart's text.
 */
export function Mermaid({ source }: MermaidProps): React.JSX.Element {
	const dark = useIsDark();
	const [state, setState] = useState<DiagramState>({ kind: "rendering" });

	useEffect(() => {
		let cancelled = false;
		const draw = async (): Promise<void> => {
			try {
				const svg = await renderDiagram(source, dark);
				if (!cancelled) {
					setState({ kind: "rendered", svg });
				}
			} catch (cause) {
				if (!cancelled) {
					setState({ kind: "failed", message: describe(cause) });
				}
			}
		};
		void draw();
		return () => {
			cancelled = true;
		};
	}, [source, dark]);

	if (state.kind === "failed") {
		return (
			<figure className="diagram diagram-failed">
				<pre>
					<code>{source}</code>
				</pre>
				<figcaption>This diagram could not be drawn: {state.message}</figcaption>
			</figure>
		);
	}

	return (
		<figure
			className="diagram"
			data-state={state.kind}
			// Mermaid renders to SVG markup it has sanitised itself; there is no element to hand it.
			dangerouslySetInnerHTML={state.kind === "rendered" ? { __html: state.svg } : undefined}
		/>
	);
}

function describe(cause: unknown): string {
	const message = cause instanceof Error ? cause.message : String(cause);
	// Mermaid's messages carry a "Parse error on line 3:" preamble worth keeping, and a dump of the
	// offending source with a caret under it, which is not worth the room.
	return message.split("\n")[0]?.trim() || "unknown error";
}
