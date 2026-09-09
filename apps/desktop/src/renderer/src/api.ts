import { createContext, use } from "react";
import type { ProctologistApi } from "../../shared/ipc.js";

declare global {
	interface Window {
		proctologist?: ProctologistApi;
	}
}

const ApiContext = createContext<ProctologistApi | undefined>(undefined);

export const ApiProvider = ApiContext.Provider;

/** The bridge the preload script exposes. Nothing else in the renderer touches Electron. */
export function useApi(): ProctologistApi {
	const api = use(ApiContext);
	if (!api) {
		throw new Error("The renderer was rendered outside an ApiProvider.");
	}
	return api;
}
