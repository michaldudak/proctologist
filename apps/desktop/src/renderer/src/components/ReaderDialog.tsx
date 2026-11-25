import { Dialog } from "@cloudflare/kumo";
import { CopyIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Markdown } from "./Markdown.js";
import { Tool } from "./Tool.js";

interface ReaderDialogProps {
	/** What is being read, for the dialog's name: "Analysis", "Review draft". */
	label: string;
	item: { number: number; title: string };
	/** What is read, and what Copy copies. */
	markdown: string;
	/** The line under the title: who wrote it and when, and anything stale about it. */
	meta: React.ReactNode;
	/** Commands that stand before Copy, for a text that can be acted on as well as read. */
	tools?: React.ReactNode;
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
 * Something the agent wrote, at reading width: a table of contents down the left, built from the
 * headings in it, and the prose and diagrams scrolling on the right. Modelled on the settings
 * dialog so the two read as the same kind of window. A text with no headings to list gets the
 * whole window instead of an empty rail.
 */
export function ReaderDialog({
	label,
	item,
	markdown,
	meta,
	tools,
	onCopy,
	onOpenLink,
	onClose,
}: ReaderDialogProps): React.JSX.Element {
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
	}, [pane, markdown]);

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
			<Dialog
				className={outline.length > 0 ? "reader-dialog" : "reader-dialog reader-dialog-plain"}
				size="xl"
			>
				<Dialog.Title className="visually-hidden">
					{label} for #{String(item.number)}
				</Dialog.Title>

				<nav className="reader-nav" aria-label="Contents" hidden={outline.length === 0}>
					<div className="settings-nav-title">Contents</div>
					{outline.map((entry) => (
						<button
							key={entry.id}
							type="button"
							className="reader-nav-item"
							data-level={entry.level}
							aria-current={entry.id === active ? "location" : undefined}
							onClick={() => jump(entry.id)}
						>
							{entry.text}
						</button>
					))}
				</nav>

				<div className="reader-pane">
					<header className="reader-pane-header">
						<div className="reader-pane-heading">
							<span className="cell-number">#{item.number}</span>
							<h2 className="settings-heading">{item.title}</h2>
						</div>
						<div className="reader-pane-meta">{meta}</div>
						<div className="panel-tools reader-pane-tools">
							{tools}
							<Tool
								icon={CopyIcon}
								label={copied ? "Copied" : "Copy as Markdown"}
								disabled={false}
								onClick={() => {
									onCopy(markdown);
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

					<div className="reader-article prose" ref={setPane}>
						<Markdown markdown={markdown} onOpenLink={onOpenLink} />
					</div>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
