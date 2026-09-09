import { useEffect, useState } from "react";

interface NoteEditorProps {
	/** Keyed by pull request so switching rows starts a fresh draft. */
	number: number;
	text: string;
	onSave: (text: string) => void;
}

/**
 * The note is private to the user and never reaches Codex, so it is a plain textarea with no
 * assistance. It saves when it loses focus, which is what a scratch pad should do.
 */
export function NoteEditor({ number, text, onSave }: NoteEditorProps): React.JSX.Element {
	const [draft, setDraft] = useState(text);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		setDraft(text);
		setSaved(false);
	}, [number, text]);

	const save = (): void => {
		if (draft === text) {
			return;
		}
		onSave(draft);
		setSaved(true);
	};

	return (
		<>
			<textarea
				className="note-editor"
				value={draft}
				rows={3}
				placeholder="Private to you. Never sent to Codex."
				aria-label="Your note"
				onChange={(event) => {
					setDraft(event.target.value);
					setSaved(false);
				}}
				onBlur={save}
				onKeyDown={(event) => {
					if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
						event.preventDefault();
						save();
					}
				}}
			/>
			<span className="header-meta">{saved ? "Saved" : "Saves when you click away"}</span>
		</>
	);
}
