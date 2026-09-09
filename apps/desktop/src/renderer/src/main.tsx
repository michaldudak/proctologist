import "@cloudflare/kumo/styles/standalone";
import "./styles/app.css";

import { TooltipProvider } from "@cloudflare/kumo";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { ApiProvider } from "./api.js";
import { TOOLTIP_DELAY } from "./components/Tooltip.js";
import { applyAppearance, readAppearance } from "./lib/appearance.js";
import { HEADER_HEIGHT, HEADER_INSET } from "../../shared/layout.js";
import type { ProctologistApi } from "../../shared/ipc.js";

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

// Before the first paint, so a dark window never flashes light on its way up.
applyAppearance(readAppearance());

// The main process places the macOS window buttons against these, so it owns the numbers.
document.documentElement.style.setProperty("--app-header-height", `${String(HEADER_HEIGHT)}px`);
document.documentElement.style.setProperty("--app-header-inset", `${String(HEADER_INSET)}px`);

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
