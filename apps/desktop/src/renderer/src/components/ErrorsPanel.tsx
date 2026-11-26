import { Button } from "@cloudflare/kumo";
import { CopyIcon, FileTextIcon, WarningCircleIcon, XIcon } from "@phosphor-icons/react";
import type { ErrorEntry } from "../../../shared/ipc.js";
import { errorText, errorTitle } from "../lib/errors.js";
import { clockTime } from "../lib/jobs.js";
import { Tool } from "./Tool.js";
import { Tooltip } from "./Tooltip.js";

interface ErrorsTriggerProps {
	/** Everything that went wrong this session. */
	count: number;
	/** How many of those arrived since the panel was last open. */
	unseen: number;
	open: boolean;
	onToggle: () => void;
}

/**
 * The header's way into the Errors panel. Only there once something has gone wrong, since an
 * empty log is nothing to point at; red while there is something the user has not looked at yet.
 */
export function ErrorsTrigger({
	count,
	unseen,
	open,
	onToggle,
}: ErrorsTriggerProps): React.JSX.Element | null {
	if (count === 0 && !open) {
		return null;
	}
	const label =
		unseen > 0
			? `${String(unseen)} new ${unseen === 1 ? "error" : "errors"}`
			: `${String(count)} ${count === 1 ? "error" : "errors"}`;
	return (
		<Tooltip content={open ? "Hide errors" : "Show errors"} render={<span />}>
			<button
				type="button"
				className="errors-trigger"
				data-unseen={unseen > 0}
				aria-pressed={open}
				aria-label={label}
				onClick={onToggle}
			>
				<WarningCircleIcon size={15} weight={unseen > 0 ? "fill" : "bold"} aria-hidden />
				{count > 0 ? <span aria-hidden>{unseen > 0 ? unseen : count}</span> : null}
			</button>
		</Tooltip>
	);
}

interface ErrorsPanelProps {
	/** Newest first. */
	errors: ErrorEntry[];
	/** True when more than one repository is tracked, so an error has to say which it is about. */
	showRepository: boolean;
	onClose: () => void;
	onClear: () => void;
	onCopy: (text: string) => void;
	onOpenLog: (path: string) => void;
}

/**
 * Everything that went wrong this session, each with its whole message: a job that failed, or the
 * part of one that did, since a run that leaves items unassessed still finishes. Docked under the
 * table rather than floating over it, so it can stay open beside the rows it explains.
 */
export function ErrorsPanel({
	errors,
	showRepository,
	onClose,
	onClear,
	onCopy,
	onOpenLog,
}: ErrorsPanelProps): React.JSX.Element {
	return (
		<section
			className="errors-panel"
			aria-labelledby="errors-panel-title"
			onKeyDown={(event) => {
				if (event.key === "Escape") {
					event.stopPropagation();
					onClose();
				}
			}}
		>
			<header className="errors-panel-header">
				<h2 id="errors-panel-title">Errors</h2>
				{errors.length > 0 ? <span className="errors-count">{errors.length}</span> : null}
				<span className="header-spacer" />
				<Button size="xs" variant="secondary" disabled={errors.length === 0} onClick={onClear}>
					Clear
				</Button>
				<Tool icon={XIcon} label="Close" emphasis="plain" disabled={false} onClick={onClose} />
			</header>
			{errors.length === 0 ? (
				<p className="errors-empty">Nothing has gone wrong this session.</p>
			) : (
				<ol className="errors-list">
					{errors.map((entry) => (
						<li key={entry.id} className="error-entry">
							<WarningCircleIcon size={15} weight="fill" aria-hidden className="error-entry-icon" />
							<span className="error-entry-title">
								{errorTitle(entry)}
								{showRepository && entry.repository !== null ? (
									<span className="error-entry-repository"> · {entry.repository}</span>
								) : null}
							</span>
							<time className="error-entry-when" dateTime={entry.at}>
								{clockTime(entry.at)}
							</time>
							<span className="error-entry-actions">
								<Tool
									icon={CopyIcon}
									label="Copy"
									disabled={false}
									onClick={() => onCopy(errorText(entry))}
								/>
								{entry.logPath === null ? null : (
									<Tool
										icon={FileTextIcon}
										label="Open the agent's log"
										disabled={false}
										onClick={() => {
											if (entry.logPath !== null) {
												onOpenLog(entry.logPath);
											}
										}}
									/>
								)}
							</span>
							<p className="error-entry-message">{entry.message}</p>
						</li>
					))}
				</ol>
			)}
		</section>
	);
}
