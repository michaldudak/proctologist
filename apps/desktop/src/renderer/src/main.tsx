import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const root = document.querySelector("#root");
if (!root) {
	throw new Error("The renderer has no root element.");
}

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
