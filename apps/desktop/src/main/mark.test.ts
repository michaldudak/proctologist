import { describe, expect, it } from "vitest";
import { alphaAt, BOUNDS, BRANCH, fit, LENS, MARK, type Placement } from "./mark.js";

/** Ten pixels to the grid unit, so a tenth of a unit is a whole pixel of ramp. */
const placement: Placement = { unit: 10, originX: 0, originY: 0 };

/** Coverage at a point given in grid units, which is how the drawing is specified. */
function at(x: number, y: number, shapes = MARK): number {
	return alphaAt(
		shapes,
		placement,
		(x - BOUNDS.left) * placement.unit,
		(y - BOUNDS.top) * placement.unit,
	);
}

describe("the mark", () => {
	it("draws the lens as a ring rather than a disc", () => {
		// Top of the lens ring, on its centre line.
		expect(at(7.4, 2.7)).toBe(1);
		// The middle of the lens stays clear, so it reads as glass.
		expect(at(7.4, 8.5)).toBe(0);
	});

	it("keeps the handle attached below the lens", () => {
		expect(at(7.4, 17)).toBe(1);
		// Past the end of the handle there is nothing.
		expect(at(7.4, 23)).toBe(0);
	});

	it("leaves a gap between the lens and the branch", () => {
		// The lens stroke ends at 14.2 and the branch starts at 15.7; the space between is empty.
		// The edges themselves sit at half coverage, so these probe just inside each stroke.
		expect(at(14.1, 8.5)).toBe(1);
		expect(at(14.5, 8.5)).toBe(0);
		expect(at(14.95, 8.5)).toBe(0);
		expect(at(15.4, 8.5)).toBe(0);
		expect(at(15.8, 8.5)).toBe(1);
	});

	it("lands the branch on a commit node", () => {
		expect(at(19, 15.9, BRANCH)).toBe(1);
		expect(at(19, 18.5, BRANCH)).toBe(0);
		expect(at(19, 21.1, BRANCH)).toBe(1);
	});

	it("splits into a lens and a branch that do not overlap", () => {
		for (const { x, y } of [
			{ x: 7.4, y: 2.7 },
			{ x: 7.4, y: 17 },
			{ x: 19, y: 21.1 },
			{ x: 16.85, y: 8.5 },
		]) {
			const both = at(x, y, LENS) > 0 && at(x, y, BRANCH) > 0;
			expect(both).toBe(false);
		}
	});

	it("centres the drawing in the square it is given", () => {
		const square = fit(160);
		expect(square.unit).toBeCloseTo(160 / BOUNDS.width);
		expect(square.originX).toBeCloseTo(0);
		// Shorter than it is wide, so the spare room goes above and below.
		expect(square.originY).toBeGreaterThan(0);
		expect(square.originY * 2 + BOUNDS.height * square.unit).toBeCloseTo(160);
	});

	it("keeps the requested padding clear", () => {
		const padded = fit(100, 10);
		expect(padded.unit).toBeCloseTo(80 / BOUNDS.width);
	});
});
