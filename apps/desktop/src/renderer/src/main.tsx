import "@cloudflare/kumo/styles/standalone";
import "./styles/app.css";

import { TooltipProvider } from "@cloudflare/kumo";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ApiProvider } from "./api.js";
import { TOOLTIP_DELAY } from "./components/Tooltip.js";
import type { ProctologistApi } from "../../shared/ipc.js";

/** Kumo tints itself from this attribute; the app follows the system rather than offering a switch. */
function followSystemTheme(): void {
	const dark = globalThis.matchMedia("(prefers-color-scheme: dark)");
	const apply = (): void => {
		document.documentElement.dataset["mode"] = dark.matches ? "dark" : "light";
	};
	apply();
	dark.addEventListener("change", apply);
}

async function resolveApi(): Promise<ProctologistApi> {
	if (window.proctologist) {
		return window.proctologist;
	}
	if (import.meta.env.DEV) {
		// Running in a plain browser: serve fixtures so the views can be worked on without Electron.
		const { createMockApi } = await import("./mock/api.js");
		return createMockApi();
	}
	throw new Error("The preload bridge is missing.");
}

const root = document.querySelector("#root");
if (!root) {
	throw new Error("The renderer has no root element.");
}

followSystemTheme();

createRoot(root).render(
	<StrictMode>
		<ApiProvider value={await resolveApi()}>
			{/* Grouping: once one tooltip is open, the next one along the row opens without waiting. */}
			<TooltipProvider delay={TOOLTIP_DELAY}>
				<App />
			</TooltipProvider>
		</ApiProvider>
	</StrictMode>,
);
