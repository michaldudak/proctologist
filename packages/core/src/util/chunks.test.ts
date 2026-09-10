import { describe, expect, it } from "vitest";
import { chunkEvenly } from "./chunks.js";

describe("chunkEvenly", () => {
	it("keeps a list that fits in one chunk whole", () => {
		expect(chunkEvenly([1, 2, 3], 16)).toEqual([[1, 2, 3]]);
	});

	it("uses as few chunks as fit under the cap, sized evenly", () => {
		const items = Array.from({ length: 17 }, (_, index) => index + 1);

		const chunks = chunkEvenly(items, 16);

		expect(chunks.map((chunk) => chunk.length)).toEqual([9, 8]);
		expect(chunks.flat()).toEqual(items);
	});

	it("fills every chunk when the count divides exactly", () => {
		expect(chunkEvenly([1, 2, 3, 4, 5, 6], 3)).toEqual([
			[1, 2, 3],
			[4, 5, 6],
		]);
	});

	it("puts the extra items in the first chunks", () => {
		expect(chunkEvenly([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
			[1, 2, 3],
			[4, 5],
			[6, 7],
		]);
	});

	it("yields nothing for nothing", () => {
		expect(chunkEvenly([], 16)).toEqual([]);
	});

	it("refuses a cap under one", () => {
		expect(() => chunkEvenly([1], 0)).toThrow(RangeError);
	});
});
