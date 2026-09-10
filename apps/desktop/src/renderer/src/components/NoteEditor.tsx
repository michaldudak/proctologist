import { useState } from "react";

interface NoteEditorProps {
	/** The saved text. Key the editor by pull request so switching rows starts a fresh draft. */
	text: string;
	onSave: (text: string) => void;
}

/**
 * The note is private to the user and never reaches the agent, so it is a plain textarea with no
 * assistance. It saves when it loses focus, which is what a scratch pad should do.
 */
export function NoteEditor({ text, onSave }: NoteEditorProps): React.JSX.Element {
	const [draft, setDraft] = useState(text);
	// The saved text this draft was last taken from. When a save comes back, or the note changes
	// underneath, the draft follows unless the user has typed on since: what is being typed wins.
	const [taken, setTaken] = useState(text);
	if (text !== taken) {
		setTaken(text);
		if (draft === taken) {
			setDraft(text);
		}
	}

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
