import { contextBridge, ipcRenderer } from "electron";
import {
	CHANNEL_PREFIX,
	EVENT_CHANNELS,
	IPC_CHANNELS,
	SYSTEM_LOCALE_ARGUMENT,
	type ProctologistApi,
	type ProctologistEvents,
} from "../shared/ipc.js";

const api = Object.fromEntries(
	IPC_CHANNELS.map((channel) => [
		channel,
		(payload: unknown) => ipcRenderer.invoke(`${CHANNEL_PREFIX}${channel}`, payload),
	]),
) as unknown as ProctologistApi;

api.locale =
	process.argv
		.find((argument) => argument.startsWith(SYSTEM_LOCALE_ARGUMENT))
		?.slice(SYSTEM_LOCALE_ARGUMENT.length) ?? navigator.language;

api.on = <K extends keyof ProctologistEvents>(
	channel: K,
	listener: (payload: ProctologistEvents[K]) => void,
): (() => void) => {
	if (!EVENT_CHANNELS.includes(channel)) {
		throw new Error(`Unknown event channel ${channel}`);
	}
	const wrapped = (_event: unknown, payload: unknown): void => {
		listener(payload as ProctologistEvents[K]);
	};
	ipcRenderer.on(`${CHANNEL_PREFIX}${channel}`, wrapped);
	return () => {
		ipcRenderer.removeListener(`${CHANNEL_PREFIX}${channel}`, wrapped);
	};
};

contextBridge.exposeInMainWorld("proctologist", api);
