import type { Job } from "@proctologist/core";
import { describe, expect, it, vi } from "vitest";
import { buildMenu, progressTitle, type TrayActions, type TrayState } from "./tray.js";

function job(overrides: Partial<Job> = {}): Job {
	return {
		id: "job-1",
		kind: "refresh",
		repository: "owner/thing",
		itemKind: null,
		number: null,
		state: "running",
		progress: null,
		error: null,
		createdAt: "2026-09-09T08:00:00.000Z",
		startedAt: "2026-09-09T08:00:00.000Z",
		finishedAt: null,
		...overrides,
	};
}

function actions(): TrayActions {
	return {
		refresh: vi.fn(),
		refreshAll: vi.fn(),
		abort: vi.fn(),
		open: vi.fn(),
		quit: vi.fn(),
	};
}

function labels(state: Partial<TrayState>): string[] {
	return buildMenu({ repositories: [], activeJobs: [], unviewed: false, ...state }, actions()).map(
		(item) => item.label ?? item.type ?? "",
	);
}

describe("progressTitle", () => {
	it("is empty when nothing is running", () => {
		expect(progressTitle([])).toBe("");
		expect(progressTitle([job({ state: "queued" })])).toBe("");
	});

	it("shows how far along the running job is", () => {
		expect(progressTitle([job({ progress: { done: 3, total: 12 } })])).toBe("3/12");
	});

	it("shows a placeholder until there is progress to report", () => {
		expect(progressTitle([job()])).toBe("…");
	});
});

describe("buildMenu", () => {
	it("offers a refresh per repository", () => {
		expect(labels({ repositories: ["owner/thing", "owner/other"] })).toEqual([
			"Refresh owner/thing",
			"Refresh owner/other",
			"Refresh all",
			"separator",
			"Open PRoctologist",
			"Quit",
		]);
	});

	it("leaves out refresh all for a single repository", () => {
		expect(labels({ repositories: ["owner/thing"] })).not.toContain("Refresh all");
	});

	it("says so when nothing is tracked", () => {
		expect(labels({})).toContain("No repositories tracked");
	});

	it("offers to stop each running job", () => {
		expect(
			labels({
				repositories: ["owner/thing"],
				activeJobs: [job(), job({ id: "job-2", kind: "review_draft", number: 12 })],
			}),
		).toEqual(
			expect.arrayContaining(["Stop refreshing owner/thing", "Stop reviewing owner/thing#12"]),
		);
	});

	it("wires the actions to the items", () => {
		const wired = actions();
		const menu = buildMenu(
			{ repositories: ["owner/thing"], activeJobs: [job()], unviewed: false },
			wired,
		);

		for (const item of menu) {
			item.click?.(undefined as never, undefined, undefined as never);
		}

		expect(wired.refresh).toHaveBeenCalledWith("owner/thing");
		expect(wired.abort).toHaveBeenCalledWith("job-1");
		expect(wired.open).toHaveBeenCalled();
		expect(wired.quit).toHaveBeenCalled();
	});
});
