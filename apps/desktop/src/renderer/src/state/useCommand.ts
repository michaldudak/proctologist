import { useCallback } from "react";
import { useApi } from "../api.js";
import { commandMessage } from "../lib/errors.js";

/**
 * Runs something the user asked for without waiting on it. A failure goes to the error log, named
 * by what was asked, so it can be read in the Errors panel rather than only in the console.
 */
export function useCommand(): (action: string, work: Promise<unknown>) => void {
	const api = useApi();
	return useCallback(
		(action, work) => {
			work.catch((cause: unknown) => {
				console.error(cause);
				api.logError({ action, message: commandMessage(cause) }).catch((logging: unknown) => {
					// The log is out of reach as well; the console is all that is left.
					console.error(logging);
				});
			});
		},
		[api],
	);
}
