import { describe, expect, it } from "vitest";
import type { ErrorEntry } from "../../../shared/ipc.js";
import { commandMessage, errorText, errorTitle, listNumbers, unseenCount } from "./errors.js";

function entry(overrides: Partial<ErrorEntry> = {}): ErrorEntry {
	return {
		id: "one",
		at: "2026-11-26T11:11:05.903Z",
		source: "assessment",
		repository: "owner/thing",
		itemKind: "pull_request",
		numbers: [12],
		message: "Claude Code failed (exit code 1): Not logged in",
		logPath: null,
		action: null,
		...overrides,
	};
}

describe("listNumbers", () => {
	it.each([
		[[12], "#12"],
		[[12, 15], "#12 and #15"],
		[[12, 15, 18], "#12, #15 and #18"],
		[[12, 15, 18, 21, 24], "#12, #15 and 3 more"],
	])("names %j as %s", (numbers, expected) => {
		expect(listNumbers(numbers)).toBe(expected);
	});
});

describe("errorTitle", () => {
	it("says what was being done, in the words of the item's kind", () => {
		expect(errorTitle(entry({ numbers: [12, 15] }))).toBe("Assess #12 and #15");
		expect(errorTitle(entry({ itemKind: "issue" }))).toBe("Triage #12");
		expect(errorTitle(entry({ source: "thorough_assessment" }))).toBe("Assess #12 thoroughly");
		expect(errorTitle(entry({ source: "review_draft" }))).toBe("Draft a review of #12");
	});

	it("names a whole repository's work by what it works through", () => {
		expect(errorTitle(entry({ source: "refresh", itemKind: null, numbers: [] }))).toBe("Refresh");
		expect(errorTitle(entry({ itemKind: "issue", numbers: [] }))).toBe("Triage issues");
	});

	it("names a command by what the user asked for", () => {
		expect(errorTitle(entry({ source: "command", action: "Refresh owner/thing" }))).toBe(
			"Refresh owner/thing",
		);
	});
});

describe("commandMessage", () => {
	it("drops what Electron wraps a handler's error in", () => {
		expect(
			commandMessage(
				new Error(
					"Error invoking remote method 'proctologist:refresh': StoreError: one is already running",
				),
			),
		).toBe("one is already running");
	});

	it("leaves any other message alone", () => {
		expect(commandMessage(new Error("Failed to fetch"))).toBe("Failed to fetch");
		expect(commandMessage("plain")).toBe("plain");
	});
});

describe("errorText", () => {
	it("carries the title, the repository, the whole message and the log", () => {
		expect(errorText(entry({ logPath: "/logs/quick.log" }))).toBe(
			"Assess #12 · owner/thing\nClaude Code failed (exit code 1): Not logged in\nLog: /logs/quick.log",
		);
	});
});

describe("unseenCount", () => {
	const errors = [entry({ id: "c" }), entry({ id: "b" }), entry({ id: "a" })];

	it("counts those newer than the last one seen", () => {
		expect(unseenCount(errors, "b")).toBe(1);
		expect(unseenCount(errors, "c")).toBe(0);
	});

	it("counts all of them when none was seen, or the one seen is gone", () => {
		expect(unseenCount(errors, null)).toBe(3);
		expect(unseenCount(errors, "gone")).toBe(3);
	});
});
