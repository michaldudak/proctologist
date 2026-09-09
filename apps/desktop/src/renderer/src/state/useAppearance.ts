import { useCallback, useEffect, useState } from "react";
import { useApi } from "../api.js";
import {
	applyAppearance,
	onSystemAppearanceChange,
	readAppearance,
	writeAppearance,
} from "../lib/appearance.js";
import type { AppearanceMode } from "../../../shared/ipc.js";

/** The window's light or dark tint, remembered across launches. */
export function useAppearance(): [AppearanceMode, (mode: AppearanceMode) => void] {
	const api = useApi();
	const [mode, setMode] = useState(readAppearance);

	useEffect(() => {
		applyAppearance(mode);
		// Electron draws the menus, the dialogs and the window chrome, so it needs telling too.
		api.setAppearance({ mode }).catch((cause: unknown) => console.error(cause));

		return mode === "system" ? onSystemAppearanceChange(() => applyAppearance(mode)) : undefined;
	}, [api, mode]);

	const choose = useCallback((next: AppearanceMode): void => {
		writeAppearance(next);
		setMode(next);
	}, []);

	return [mode, choose];
}
