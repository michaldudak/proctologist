import { useEffect, useState } from "react";

interface NoteEditorProps {
	/** Keyed by pull request so switching rows starts a fresh draft. */
	number: number;
	text: string;
	onSave: (text: string) => void;
}

/**
 * The note is private to the user and never reaches the agent, so it is a plain textarea with no
 * assistance. It saves when it loses focus, which is what a scratch pad should do.
 */
export function NoteEditor({ number, text, onSave }: NoteEditorProps): React.JSX.Element {
	const [draft, setDraft] = useState(text);

	useEffect(() => {
		setDraft(text);
	}, [number, text]);

	const save = (): void => {
		if (draft !== text) {
			onSave(draft);
		}
	};

	return (
		<textarea
			className="note-editor"
			value={draft}
			rows={3}
			aria-label="Your private note"
			onChange={(event) => setDraft(event.target.value)}
			onBlur={save}
			onKeyDown={(event) => {
				if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					save();
				}
			}}
		/>
	);
}
