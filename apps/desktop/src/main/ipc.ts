import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { CHANNEL_PREFIX, IPC_CHANNELS } from "../shared/ipc.js";
import type { Handlers } from "./handlers.js";

/**
 * Binds the handlers to `ipcMain`. Keeping the binding this thin is what lets the handlers
 * themselves be tested without starting Electron.
 */
export function registerIpc(handlers: Handlers): () => void {
	for (const channel of IPC_CHANNELS) {
		ipcMain.handle(
			`${CHANNEL_PREFIX}${channel}`,
			async (_event: IpcMainInvokeEvent, payload: unknown) => {
				const handler = handlers[channel] as (input: unknown) => Promise<unknown>;
				return handler(payload);
			},
		);
	}

	return () => {
		for (const channel of IPC_CHANNELS) {
			ipcMain.removeHandler(`${CHANNEL_PREFIX}${channel}`);
		}
	};
}
