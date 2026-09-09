import { APPEARANCE_MODES, type AppearanceMode } from "../../../shared/ipc.js";

/** Where the choice lives. It belongs to the window, not to the hand-edited config file. */
const STORAGE_KEY = "proctologist:appearance";
const DARK = "(prefers-color-scheme: dark)";

export function readAppearance(): AppearanceMode {
	const stored = globalThis.localStorage.getItem(STORAGE_KEY);
	return APPEARANCE_MODES.find((mode) => mode === stored) ?? "system";
}

export function writeAppearance(mode: AppearanceMode): void {
	globalThis.localStorage.setItem(STORAGE_KEY, mode);
}

/**
 * Kumo tints itself from `data-mode`; `color-scheme` is what the scrollbars, the caret and the
 * built-in form controls read, and neither one follows the other on its own.
 */
export function applyAppearance(mode: AppearanceMode): void {
	const dark = mode === "dark" || (mode === "system" && globalThis.matchMedia(DARK).matches);
	document.documentElement.dataset["mode"] = dark ? "dark" : "light";
	document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

/** Calls back when the system appearance changes; returns a function that stops listening. */
export function onSystemAppearanceChange(listener: () => void): () => void {
	const query = globalThis.matchMedia(DARK);
	query.addEventListener("change", listener);
	return () => query.removeEventListener("change", listener);
}
