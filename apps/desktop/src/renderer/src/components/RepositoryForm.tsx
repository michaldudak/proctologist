import { Button, Field, Input } from "@cloudflare/kumo";
import { useEffect, useState } from "react";
import type { TrackedRepository } from "@proctologist/core/browser";
import { useApi } from "../api.js";
import type { RemoteCheck } from "../../../shared/ipc.js";

const REPOSITORY_PATTERN =
	/^[A-Za-z0-9._-]*[A-Za-z0-9_-][A-Za-z0-9._-]*\/[A-Za-z0-9._-]*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export interface RepositoryDraft {
	name: string;
	clone: string;
	context: string;
	reviewInstructions: string;
}

export const EMPTY_DRAFT: RepositoryDraft = {
	name: "",
	clone: "",
	context: "",
	reviewInstructions: "",
};

export function toDraft(repository: TrackedRepository): RepositoryDraft {
	return {
		name: repository.name,
		clone: repository.clone ?? "",
		context: repository.context ?? "",
		reviewInstructions: repository.reviewInstructions ?? "",
	};
}

export function fromDraft(draft: RepositoryDraft): TrackedRepository {
	const [owner = "", repo = ""] = draft.name.split("/");
	return {
		name: draft.name.trim(),
		owner,
		repo,
		clone: draft.clone.trim() === "" ? undefined : draft.clone.trim(),
		context: draft.context.trim() === "" ? undefined : draft.context.trim(),
		reviewInstructions:
			draft.reviewInstructions.trim() === "" ? undefined : draft.reviewInstructions.trim(),
		codexProfiles: {},
	};
}

export function isValidName(name: string): boolean {
	return REPOSITORY_PATTERN.test(name.trim());
}

interface RepositoryFormProps {
	draft: RepositoryDraft;
	onChange: (draft: RepositoryDraft) => void;
	/** Locked once a repository is tracked: the name is its identity in the database. */
	nameEditable: boolean;
}

export function RepositoryForm({
	draft,
	onChange,
	nameEditable,
}: RepositoryFormProps): React.JSX.Element {
	const api = useApi();
	const [remote, setRemote] = useState<RemoteCheck | undefined>(undefined);

	// The remote is what decides where worktrees fetch from, so a mismatch is worth saying early.
	useEffect(() => {
		if (!isValidName(draft.name) || draft.clone.trim() === "") {
			setRemote(undefined);
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			void (async (): Promise<void> => {
				const result = await api.checkRemote({
					repository: draft.name.trim(),
					clone: draft.clone.trim(),
				});
				if (!cancelled) {
					setRemote(result);
				}
			})();
		}, 250);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [api, draft.name, draft.clone]);

	return (
		<div className="form-grid">
			<Input
				label="Repository"
				description="As GitHub writes it, for example octocat/hello-world."
				error={
					draft.name !== "" && !isValidName(draft.name) ? "Write it as owner/name." : undefined
				}
				value={draft.name}
				disabled={!nameEditable}
				placeholder="owner/name"
				onChange={(event) => onChange({ ...draft, name: event.target.value })}
			/>

			<div className="filter-row filter-row-bottom">
				<div className="form-grow">
					<Input
						label="Local clone"
						required={false}
						description="Used as the object store for worktrees, so Codex can check the code."
						value={draft.clone}
						placeholder="~/Projects/thing"
						onChange={(event) => onChange({ ...draft, clone: event.target.value })}
					/>
				</div>
				<Button
					size="xs"
					onClick={() => {
						void (async (): Promise<void> => {
							const folder = await api.chooseCloneFolder();
							if (folder !== null) {
								onChange({ ...draft, clone: folder });
							}
						})();
					}}
				>
					Choose…
				</Button>
			</div>

			{remote ? (
				<p className={remote.ok ? "header-meta" : "error"}>
					{remote.ok
						? `Will fetch from the "${remote.remote ?? ""}" remote.`
						: (remote.message ?? "No matching remote.")}
				</p>
			) : null}

			<Field
				label="Repository context"
				required={false}
				description="Free text appended to the assessment prompt for this repository."
			>
				<textarea
					className="note-editor"
					rows={3}
					aria-label="Repository context"
					value={draft.context}
					onChange={(event) => onChange({ ...draft, context: event.target.value })}
				/>
			</Field>

			<Field
				label="Review instructions"
				required={false}
				description="Used as the review draft prompt, for example a repository's own review skill."
			>
				<textarea
					className="note-editor"
					rows={3}
					aria-label="Review instructions"
					value={draft.reviewInstructions}
					onChange={(event) => onChange({ ...draft, reviewInstructions: event.target.value })}
				/>
			</Field>
		</div>
	);
}
