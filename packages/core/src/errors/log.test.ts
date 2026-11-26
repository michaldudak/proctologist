import { describe, expect, it, vi } from "vitest";
import { createErrorLog } from "./log.js";

describe("the error log", () => {
	it("lists the newest first, with what was left out filled in", () => {
		const log = createErrorLog({ now: () => "2026-11-26T11:00:00.000Z" });

		log.add({ source: "refresh", repository: "owner/thing", message: "HTTP 504" });
		log.add({
			source: "assessment",
			repository: "owner/thing",
			itemKind: "pull_request",
			numbers: [5, 7],
			message: "Claude Code failed",
			logPath: "/logs/quick.log",
		});

		expect(log.list()).toMatchObject([
			{ source: "assessment", numbers: [5, 7], logPath: "/logs/quick.log" },
			{
				source: "refresh",
				itemKind: null,
				numbers: [],
				logPath: null,
				at: "2026-11-26T11:00:00.000Z",
			},
		]);
	});

	it("keeps only as many as it is allowed, dropping the oldest", () => {
		const log = createErrorLog({ limit: 2 });

		for (const message of ["one", "two", "three"]) {
			log.add({ source: "command", message });
		}

		expect(log.list().map((entry) => entry.message)).toEqual(["three", "two"]);
	});

	it("tells its listeners of each error and of being emptied", () => {
		const log = createErrorLog();
		const onAdd = vi.fn();
		const onClear = vi.fn();
		const stop = log.onAdd(onAdd);
		log.onClear(onClear);

		const entry = log.add({ source: "command", message: "no" });
		stop();
		log.add({ source: "command", message: "unheard" });
		log.clear();

		expect(onAdd).toHaveBeenCalledExactlyOnceWith(entry);
		expect(onClear).toHaveBeenCalledOnce();
		expect(log.list()).toEqual([]);
	});
});
