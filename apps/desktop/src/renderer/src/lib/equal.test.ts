import { describe, expect, it } from "vitest";
import { isDeepEqual } from "./equal.js";

describe("isDeepEqual", () => {
	it("compares primitives by value", () => {
		expect(isDeepEqual(1, 1)).toBe(true);
		expect(isDeepEqual("a", "a")).toBe(true);
		expect(isDeepEqual(null, null)).toBe(true);
		expect(isDeepEqual(undefined, undefined)).toBe(true);
		expect(isDeepEqual(1, "1")).toBe(false);
		expect(isDeepEqual(null, undefined)).toBe(false);
		expect(isDeepEqual(Number.NaN, Number.NaN)).toBe(true);
	});

	it("compares arrays element by element", () => {
		expect(isDeepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
		expect(isDeepEqual([1, 2], [1, 2, 3])).toBe(false);
		expect(isDeepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
	});

	it("compares objects key by key, whatever the key order", () => {
		expect(isDeepEqual({ a: 1, b: { c: [1] } }, { b: { c: [1] }, a: 1 })).toBe(true);
		expect(isDeepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
		expect(isDeepEqual({ a: 1 }, { a: 2 })).toBe(false);
		expect(isDeepEqual({ a: 1 }, null)).toBe(false);
	});
});
