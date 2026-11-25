import { useState } from "react";

interface NoteEditorProps {
	/** The saved text. Key the editor by pull request so switching rows starts a fresh draft. */
	text: string;
	onSave: (text: string) => void;
	/** Takes the caret on mount, for an editor the user has just asked for. */
	focused?: boolean;
	/** Told what was left in the editor when the user leaves it, after any save. */
	onLeave?: (draft: string) => void;
}

/**
 * The note is private to the user and never reaches the agent, so it is a plain textarea with no
 * assistance. It saves when it loses focus, which is what a scratch pad should do.
 */
export function NoteEditor({
	text,
	onSave,
	focused = false,
	onLeave,
}: NoteEditorProps): React.JSX.Element {
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
			ref={focused ? focus : undefined}
			onChange={(event) => setDraft(event.target.value)}
			onBlur={() => {
				save();
				onLeave?.(draft);
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					save();
				}
			}}
		/>
	);
}

/** A ref callback rather than autoFocus: the editor is asked for by a click, long after the page loaded. */
function focus(element: HTMLTextAreaElement | null): void {
	element?.focus();
}
