import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
	main: {
		plugins: [externalizeDepsPlugin()],
		// `lib` rather than `rollupOptions.input`: the latter replaces electron-vite's defaults,
		// which is what keeps `electron` itself out of the bundle.
		build: { lib: { entry: "src/main/index.ts" } },
	},
	preload: {
		plugins: [externalizeDepsPlugin()],
		build: {
			lib: {
				entry: "src/preload/index.ts",
				formats: ["es"],
				// Electron only loads a preload script as a module when it ends in .mjs.
				fileName: () => "index.mjs",
			},
		},
	},
	renderer: {
		root: "src/renderer",
		plugins: [react()],
		// No explicit `rollupOptions.input`: Vite resolves it against `root`, which would point at
		// src/renderer/src/renderer/index.html. electron-vite's default is the right absolute path.
	},
});
