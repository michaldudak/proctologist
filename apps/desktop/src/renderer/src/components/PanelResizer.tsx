import { useCallback, useEffect, useRef } from "react";

interface PanelResizerProps {
	width: number;
	onChange: (width: number) => void;
	min: number;
	max: number;
}

const STEP = 16;

/**
 * The grab handle on the panel's left edge. It drags, and it also takes the arrow keys, because a
 * separator that only answers to the mouse is one more thing the keyboard cannot reach.
 */
export function PanelResizer({ width, onChange, min, max }: PanelResizerProps): React.JSX.Element {
	const dragging = useRef(false);

	const clamp = useCallback(
		(value: number): number => Math.min(Math.max(value, min), max),
		[min, max],
	);

	// Bound to the window, not the handle: the pointer outruns a 5px target long before the drag ends.
	useEffect(() => {
		const move = (event: MouseEvent): void => {
			if (dragging.current) {
				event.preventDefault();
				onChange(clamp(globalThis.innerWidth - event.clientX));
			}
		};
		const stop = (): void => {
			dragging.current = false;
			document.body.classList.remove("resizing");
		};

		globalThis.addEventListener("mousemove", move);
		globalThis.addEventListener("mouseup", stop);
		return () => {
			globalThis.removeEventListener("mousemove", move);
			globalThis.removeEventListener("mouseup", stop);
			stop();
		};
	}, [clamp, onChange]);

	return (
		<div
			className="panel-resizer"
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize the panel"
			aria-valuenow={Math.round(width)}
			aria-valuemin={min}
			aria-valuemax={max}
			tabIndex={0}
			onMouseDown={(event) => {
				event.preventDefault();
				dragging.current = true;
				document.body.classList.add("resizing");
			}}
			onDoubleClick={() => onChange(clamp(DEFAULT_PANEL_WIDTH))}
			onKeyDown={(event) => {
				// Left widens: the panel is on the right, so its edge moves the other way.
				const delta =
					event.key === "ArrowLeft" ? STEP : event.key === "ArrowRight" ? -STEP : undefined;
				if (delta !== undefined) {
					event.preventDefault();
					onChange(clamp(width + delta));
				}
			}}
		/>
	);
}

/** What the panel opens at, and what a double click on the handle puts it back to. */
export const DEFAULT_PANEL_WIDTH = 416;
export const MIN_PANEL_WIDTH = 320;
/** Leaves the table a usable width even on the smallest window the app allows. */
export const MAX_PANEL_WIDTH = 720;
