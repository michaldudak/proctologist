import { describe, expect, it } from "vitest";
import type { RefreshCandidate } from "../../../shared/ipc.js";
import {
	countBots,
	countByReason,
	countDrafts,
	defaultChoices,
	selectCandidates,
} from "./candidates.js";

function candidate(overrides: Partial<RefreshCandidate> & { number: number }): RefreshCandidate {
	return {
		title: `Pull request ${String(overrides.number)}`,
		reason: "never",
		isBot: false,
		isDraft: false,
		authoredByUser: false,
		lastActivityAt: "2026-09-01T00:00:00.000Z",
		...overrides,
	};
}

const candidates = [
	candidate({ number: 1, lastActivityAt: "2026-09-09T00:00:00.000Z" }),
	candidate({ number: 2, isBot: true, lastActivityAt: "2026-09-08T00:00:00.000Z" }),
	candidate({
		number: 3,
		isDraft: true,
		reason: "changed",
		lastActivityAt: "2026-09-07T00:00:00.000Z",
	}),
	candidate({ number: 4, reason: "aged", lastActivityAt: "2026-09-06T00:00:00.000Z" }),
	candidate({ number: 5, reason: "failed", lastActivityAt: "2026-09-05T00:00:00.000Z" }),
];

function numbers(choices: Partial<ReturnType<typeof defaultChoices>>): number[] {
	return selectCandidates(candidates, { ...defaultChoices(), ...choices }).map(
		(item) => item.number,
	);
}

describe("counts", () => {
	it("groups by why each one is due", () => {
		expect(countByReason(candidates)).toEqual({ never: 2, changed: 1, aged: 1, failed: 1 });
	});

	it("counts bots and drafts", () => {
		expect(countBots(candidates)).toBe(1);
		expect(countDrafts(candidates)).toBe(1);
	});
});

describe("selectCandidates", () => {
	it("keeps everything by default", () => {
		expect(numbers({})).toEqual([1, 2, 3, 4, 5]);
	});

	it("drops the reasons that are switched off", () => {
		expect(
			numbers({ reasons: { never: true, changed: false, aged: false, failed: false } }),
		).toEqual([1, 2]);
	});

	it("skips bots and drafts when asked", () => {
		expect(numbers({ skipBots: true })).toEqual([1, 3, 4, 5]);
		expect(numbers({ skipDrafts: true })).toEqual([1, 2, 4, 5]);
		expect(numbers({ skipBots: true, skipDrafts: true })).toEqual([1, 4, 5]);
	});

	it("keeps the most recently active when limited", () => {
		expect(numbers({ limit: 2 })).toEqual([1, 2]);
	});

	it("applies the limit after the other choices", () => {
		expect(numbers({ skipBots: true, limit: 2 })).toEqual([1, 3]);
	});

	it("leaves the order alone when the limit is not reached", () => {
		expect(numbers({ limit: 99 })).toEqual([1, 2, 3, 4, 5]);
	});

	it("can be narrowed to nothing", () => {
		expect(numbers({ limit: 0 })).toEqual([]);
		expect(
			numbers({ reasons: { never: false, changed: false, aged: false, failed: false } }),
		).toEqual([]);
	});

	it("leaves the original list alone", () => {
		const before = [...candidates];
		selectCandidates(candidates, { ...defaultChoices(), limit: 1 });

		expect(candidates).toEqual(before);
	});
});
