import { Button, Field, Input, Switch } from "@cloudflare/kumo";
import { useCallback, useState } from "react";
import type { TrackedRepository } from "@proctologist/core/browser";
import { useApi } from "../api.js";
import type { RemoteCheck } from "../../../shared/ipc.js";

const REPOSITORY_PATTERN =
	/^[A-Za-z0-9._-]*[A-Za-z0-9_-][A-Za-z0-9._-]*\/[A-Za-z0-9._-]*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

export interface RepositoryDraft {
	name: string;
	clone: string;
	context: string;
	thoroughInstructions: string;
	reviewInstructions: string;
	/** Whether this repository's issues are fetched and triaged too. */
	issues: boolean;
}

export const EMPTY_DRAFT: RepositoryDraft = {
	name: "",
	issues: false,
	clone: "",
	context: "",
	thoroughInstructions: "",
	reviewInstructions: "",
};

export function toDraft(repository: TrackedRepository): RepositoryDraft {
	return {
		name: repository.name,
		issues: repository.issues,
		clone: repository.clone ?? "",
		context: repository.context ?? "",
		thoroughInstructions: repository.thoroughInstructions ?? "",
		reviewInstructions: repository.reviewInstructions ?? "",
	};
}

export function fromDraft(draft: RepositoryDraft): TrackedRepository {
	const [owner = "", repo = ""] = draft.name.split("/");
	return {
		name: draft.name.trim(),
		owner,
		repo,
		issues: draft.issues,
		clone: draft.clone.trim() === "" ? undefined : draft.clone.trim(),
		context: draft.context.trim() === "" ? undefined : draft.context.trim(),
		thoroughInstructions:
			draft.thoroughInstructions.trim() === "" ? undefined : draft.thoroughInstructions.trim(),
		reviewInstructions:
			draft.reviewInstructions.trim() === "" ? undefined : draft.reviewInstructions.trim(),
		profiles: {},
	};
}

export function isValidName(name: string): boolean {
	return REPOSITORY_PATTERN.test(name.trim());
}

interface RepositoryFormProps {
	draft: RepositoryDraft;
	/** `settled` is false while text is still being typed, true for a folder picked from a dialog. */
	onChange: (draft: RepositoryDraft, settled: boolean) => void;
	/** Locked once a repository is tracked: the name is its identity in the database. */
	nameEditable: boolean;
	/** Something the form cannot know on its own, such as the name already being tracked. */
	nameError?: string | undefined;
}

export function RepositoryForm({
	draft,
	onChange,
	nameEditable,
	nameError,
}: RepositoryFormProps): React.JSX.Element {
	const api = useApi();
	const [remote, setRemote] = useState<RemoteCheck | undefined>(undefined);

	/**
	 * The remote decides where worktrees fetch from, so a mismatch is worth saying. It is checked
	 * when a field is finished with rather than as it is typed: half a repository name never matches
	 * anything, and complaining about it while someone types is just noise.
	 */
	const check = useCallback(
		(next: RepositoryDraft): void => {
			if (!isValidName(next.name) || next.clone.trim() === "") {
				setRemote(undefined);
				return;
			}
			void (async (): Promise<void> => {
				setRemote(
					await api.checkRemote({
						repository: next.name.trim(),
						clone: next.clone.trim(),
					}),
				);
			})();
		},
		[api],
	);

	/** Editing invalidates whatever the last check said; it is re-run when the field is left. */
	const edit = (next: RepositoryDraft): void => {
		setRemote(undefined);
		onChange(next, false);
	};

	return (
		<div className="form-grid">
			<Input
				label="Repository"
				description="As GitHub writes it, for example octocat/hello-world."
				error={
					draft.name !== "" && !isValidName(draft.name) ? "Write it as owner/name." : nameError
				}
				value={draft.name}
				disabled={!nameEditable}
				placeholder="owner/name"
				onChange={(event) => edit({ ...draft, name: event.target.value })}
				onBlur={() => check(draft)}
			/>

			<div>
				<div className="form-row">
					<div className="form-grow">
						<Input
							label="Local clone"
							required={false}
							value={draft.clone}
							placeholder="~/Projects/thing"
							onChange={(event) => edit({ ...draft, clone: event.target.value })}
							onBlur={() => check(draft)}
						/>
					</div>
					<Button
						onClick={() => {
							void (async (): Promise<void> => {
								const folder = await api.chooseCloneFolder();
								if (folder !== null) {
									const next = { ...draft, clone: folder };
									onChange(next, true);
									check(next);
								}
							})();
						}}
					>
						Choose…
					</Button>
				</div>
				<p className="form-hint">
					Used as the object store for worktrees, so the agent can check the code.
				</p>
			</div>

			{remote ? (
				<p className={remote.ok ? "header-meta" : "error"}>
					{remote.ok
						? `Will fetch from the "${remote.remote ?? ""}" remote.`
						: (remote.message ?? "No matching remote.")}
				</p>
			) : null}

			<Field
				label="Track the issues too"
				required={false}
				description="Off by default: a repository tracked for its pull requests should not quietly pull a thousand issues into the database. Issues are triaged rather than assessed, and cost far less."
			>
				<Switch
					aria-label="Track the issues too"
					checked={draft.issues}
					onClick={() => onChange({ ...draft, issues: !draft.issues }, true)}
				/>
			</Field>

			<Field
				label="Assessment instructions"
				required={false}
				description="Appended to the assessment prompt for this repository: what matters here, what to ignore."
			>
				<textarea
					className="note-editor"
					rows={3}
					aria-label="Assessment instructions"
					value={draft.context}
					onChange={(event) => onChange({ ...draft, context: event.target.value }, false)}
				/>
			</Field>

			<Field
				label="Thorough assessment instructions"
				required={false}
				description="Appended after the assessment instructions when a pull request gets a thorough look: what to build, run or check."
			>
				<textarea
					className="note-editor"
					rows={3}
					aria-label="Thorough assessment instructions"
					value={draft.thoroughInstructions}
					onChange={(event) =>
						onChange({ ...draft, thoroughInstructions: event.target.value }, false)
					}
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
					onChange={(event) =>
						onChange({ ...draft, reviewInstructions: event.target.value }, false)
					}
				/>
			</Field>
		</div>
	);
}
