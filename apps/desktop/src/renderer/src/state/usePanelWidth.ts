import { useCallback, useState } from "react";
import {
	DEFAULT_PANEL_WIDTH,
	MAX_PANEL_WIDTH,
	MIN_PANEL_WIDTH,
} from "../components/PanelResizer.js";

const STORAGE_KEY = "proctologist:panel-width";

/** The panel's width, remembered across launches the way a window's own size would be. */
export function usePanelWidth(): [number, (width: number) => void] {
	const [width, setWidth] = useState(read);

	const change = useCallback((next: number): void => {
		setWidth(next);
		globalThis.localStorage.setItem(STORAGE_KEY, String(Math.round(next)));
	}, []);

	return [width, change];
}

function read(): number {
	const stored = Number(globalThis.localStorage.getItem(STORAGE_KEY));
	if (!Number.isFinite(stored) || stored === 0) {
		return DEFAULT_PANEL_WIDTH;
	}
	return Math.min(Math.max(stored, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH);
}
