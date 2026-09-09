import type { ProctologistApi } from "../../shared/ipc.js";

declare global {
	interface Window {
		proctologist: ProctologistApi;
	}
}

/** The bridge the preload script exposes. Nothing else in the renderer touches Electron. */
export const api: ProctologistApi = window.proctologist;
