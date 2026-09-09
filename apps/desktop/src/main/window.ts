import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, shell } from "electron";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface MainWindow {
	show: () => void;
	/** Shows the window and tells the renderer which repository to open. */
	showRepository: (repository: string) => void;
	send: (channel: string, payload: unknown) => void;
	isVisible: () => boolean;
	/** Lets the window close for real, for quitting. */
	allowClose: () => void;
}

export function createMainWindow(): MainWindow {
	let closable = false;

	const window = new BrowserWindow({
		width: 1280,
		height: 800,
		minWidth: 900,
		minHeight: 560,
		show: false,
		titleBarStyle: "hiddenInset",
		webPreferences: {
			preload: path.join(here, "../preload/index.mjs"),
			sandbox: false,
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	// Closing the window hides it; the app lives in the menu bar until it is quit.
	window.on("close", (event) => {
		if (!closable) {
			event.preventDefault();
			window.hide();
		}
	});

	// Renderer problems would otherwise only be visible with the developer tools open.
	window.webContents.on("console-message", (event) => {
		if (event.level === "error" || event.level === "warning") {
			console.warn(`renderer: ${event.message}`);
		}
	});

	// Anything the page tries to open goes to the browser, never to a second Electron window.
	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	const devServer = process.env["ELECTRON_RENDERER_URL"];
	if (devServer) {
		void window.loadURL(devServer);
	} else {
		void window.loadFile(path.join(here, "../renderer/index.html"));
	}

	return {
		show: () => {
			window.show();
			window.focus();
		},
		showRepository: (repository) => {
			window.show();
			window.focus();
			window.webContents.send("proctologist:show-repository", repository);
		},
		send: (channel, payload) => {
			if (!window.isDestroyed()) {
				window.webContents.send(channel, payload);
			}
		},
		isVisible: () => window.isVisible(),
		allowClose: () => {
			closable = true;
		},
	};
}
