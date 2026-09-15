import { Badge, Dialog } from "@cloudflare/kumo";
import { CopyIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { AGENT_LABELS, type Analysis } from "@proctologist/core/browser";
import { absoluteDate } from "../lib/format.js";
import { Markdown } from "./Markdown.js";
import { Tool } from "./Tool.js";

interface AnalysisDialogProps {
	analysis: Analysis;
	item: { number: number; title: string };
	outdated: boolean;
	onCopy: (text: string) => void;
	onOpenLink: (url: string) => void;
	onClose: () => void;
}

interface OutlineEntry {
	id: string;
	text: string;
	level: 2 | 3;
}

/** How far below the top of the pane a heading counts as the one being read. */
const READING_LINE = 96;

/**
 * The analysis at reading width: a table of contents down the left, built from the headings the
 * agent wrote, and the prose and diagrams scrolling on the right. Modelled on the settings dialog
 * so the two read as the same kind of window.
 */
export function AnalysisDialog({
	analysis,
	item,
	outdated,
	onCopy,
	onOpenLink,
	onClose,
}: AnalysisDialogProps): React.JSX.Element {
	// The dialog's content mounts in a portal, so the pane is known through state rather than a
	// ref: the outline and the scroll tracking start once it exists.
	const [pane, setPane] = useState<HTMLDivElement | null>(null);
	const [outline, setOutline] = useState<OutlineEntry[]>([]);
	const [active, setActive] = useState<string | undefined>(undefined);
	const [copied, setCopied] = useState(false);

	// The outline is read off the rendered headings, so it can only ever point at anchors that exist.
	useEffect(() => {
		const headings = pane?.querySelectorAll<HTMLHeadingElement>("h2, h3") ?? [];
		setOutline(
			[...headings].map((heading) => ({
				id: heading.id,
				text: heading.textContent ?? "",
				level: heading.tagName === "H2" ? 2 : 3,
			})),
		);
	}, [pane, analysis.markdown]);

	useEffect(() => {
		if (!pane) {
			return undefined;
		}
		let frame: number | undefined;
		const update = (): void => {
			frame = undefined;
			const line = pane.scrollTop + READING_LINE;
			let current: string | undefined;
			for (const heading of pane.querySelectorAll<HTMLHeadingElement>("h2, h3")) {
				if (heading.offsetTop <= line) {
					current = heading.id;
				}
			}
			setActive(current ?? outline[0]?.id);
		};
		const onScroll = (): void => {
			frame ??= requestAnimationFrame(update);
		};
		update();
		pane.addEventListener("scroll", onScroll, { passive: true });
		return () => {
			pane.removeEventListener("scroll", onScroll);
			if (frame !== undefined) {
				cancelAnimationFrame(frame);
			}
		};
	}, [pane, outline]);

	useEffect(() => {
		if (!copied) {
			return undefined;
		}
		const timer = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(timer);
	}, [copied]);

	const jump = (id: string): void => {
		const heading = pane?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
		heading?.scrollIntoView({ block: "start", behavior: "smooth" });
	};

	return (
		<Dialog.Root open onOpenChange={(next) => !next && onClose()}>
			<Dialog className="analysis-dialog" size="xl">
				<Dialog.Title className="visually-hidden">
					Analysis of pull request {String(item.number)}
				</Dialog.Title>

				<nav className="analysis-nav" aria-label="Contents">
					<div className="settings-nav-title">Contents</div>
					{outline.map((entry) => (
						<button
							key={entry.id}
							type="button"
							className="analysis-nav-item"
							data-level={entry.level}
							aria-current={entry.id === active ? "location" : undefined}
							onClick={() => jump(entry.id)}
						>
							{entry.text}
						</button>
					))}
				</nav>

				<div className="analysis-pane">
					<header className="analysis-pane-header">
						<div className="analysis-pane-heading">
							<span className="cell-number">#{item.number}</span>
							<h2 className="settings-heading">{item.title}</h2>
						</div>
						<div className="analysis-pane-meta">
							<span className="header-meta">
								Written {absoluteDate(analysis.createdAt)}
								{analysis.agent ? ` by ${AGENT_LABELS[analysis.agent]}` : ""}
								{analysis.model ? ` (${analysis.model})` : ""}
							</span>
							{outdated ? (
								<Badge variant="warning">Describes an older version of the pull request</Badge>
							) : null}
						</div>
						<div className="panel-tools analysis-pane-tools">
							<Tool
								icon={CopyIcon}
								label={copied ? "Copied" : "Copy as Markdown"}
								disabled={false}
								onClick={() => {
									onCopy(analysis.markdown);
									setCopied(true);
								}}
							/>
							<Dialog.Close
								render={<button type="button" className="tool-button" aria-label="Close" />}
							>
								<XIcon size={15} aria-hidden />
							</Dialog.Close>
						</div>
					</header>

					<div className="analysis-article prose" ref={setPane}>
						<Markdown markdown={analysis.markdown} onOpenLink={onOpenLink} />
					</div>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
