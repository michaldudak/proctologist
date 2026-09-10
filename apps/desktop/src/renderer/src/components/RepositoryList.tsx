import { Button } from "@cloudflare/kumo";
import { CaretRightIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
	EMPTY_DRAFT,
	RepositoryForm,
	isValidName,
	type RepositoryDraft,
} from "./RepositoryForm.js";

interface RepositoryListProps {
	repositories: RepositoryDraft[];
	/** `settled` is false while a field is still being typed, true once the list itself changed. */
	onChange: (repositories: RepositoryDraft[], settled: boolean) => void;
}

/**
 * The tracked repositories as a list of names, each opening into its own form, and one form for
 * adding another. Only one thing is open at a time: a settings pane full of every repository's
 * instructions is a lot to scroll past to find the one to change.
 */
export function RepositoryList({ repositories, onChange }: RepositoryListProps): React.JSX.Element {
	/** The name of the open entry, "" for the add form, or nothing. */
	const [open, setOpen] = useState<string | undefined>(repositories.length === 0 ? "" : undefined);
	const [added, setAdded] = useState<RepositoryDraft>(EMPTY_DRAFT);

	const taken = repositories.some((entry) => entry.name.trim() === added.name.trim());
	const addable = isValidName(added.name) && !taken;

	const add = (): void => {
		onChange([...repositories, { ...added, name: added.name.trim() }], true);
		setAdded(EMPTY_DRAFT);
		setOpen(undefined);
	};

	return (
		<div className="repository-list">
			{repositories.length === 0 ? (
				<p className="settings-lede">
					Nothing is tracked yet. Add a repository and its pull requests show up on the next
					refresh.
				</p>
			) : null}

			{repositories.map((entry, index) => {
				const expanded = open === entry.name;
				return (
					<div key={entry.name} className="repository-entry" data-open={expanded ? "" : undefined}>
						<button
							type="button"
							className="repository-entry-trigger"
							aria-expanded={expanded}
							onClick={() => setOpen(expanded ? undefined : entry.name)}
						>
							<CaretRightIcon
								size={12}
								weight="bold"
								aria-hidden
								className="repository-entry-caret"
							/>
							<span className="repository-entry-name">{entry.name}</span>
							<span className="repository-entry-meta">
								{entry.clone.trim() === "" ? "No local clone" : entry.clone}
							</span>
						</button>
						{expanded ? (
							<div className="repository-entry-body">
								<RepositoryForm
									draft={entry}
									nameEditable={false}
									onChange={(next, settled) =>
										onChange(
											repositories.map((item, i) => (i === index ? next : item)),
											settled,
										)
									}
								/>
								<div className="form-actions">
									<Button
										size="xs"
										variant="secondary-destructive"
										onClick={() => {
											onChange(
												repositories.filter((_item, i) => i !== index),
												true,
											);
											setOpen(undefined);
										}}
									>
										Stop tracking
									</Button>
								</div>
							</div>
						) : null}
					</div>
				);
			})}

			{open === "" ? (
				<div className="repository-entry" data-open="">
					<div className="repository-entry-body">
						<h3>Add a repository</h3>
						<RepositoryForm
							draft={added}
							nameEditable
							onChange={setAdded}
							nameError={taken && added.name !== "" ? "Already tracked." : undefined}
						/>
						<div className="form-actions">
							<Button size="xs" variant="primary" disabled={!addable} onClick={add}>
								Add
							</Button>
							<Button
								size="xs"
								variant="ghost"
								onClick={() => {
									setAdded(EMPTY_DRAFT);
									setOpen(undefined);
								}}
							>
								Cancel
							</Button>
						</div>
					</div>
				</div>
			) : (
				<div className="repository-list-add">
					<Button size="xs" variant="secondary" onClick={() => setOpen("")}>
						<PlusIcon size={12} aria-hidden /> Add a repository
					</Button>
				</div>
			)}
		</div>
	);
}
