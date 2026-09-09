import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * Serves the renderer on its own in a browser, where it falls back to the fixture bridge. Only for
 * working on the views; the app itself is built by electron-vite.
 */
export default defineConfig({
	root: "src/renderer",
	plugins: [react()],
});
