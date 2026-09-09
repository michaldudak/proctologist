/**
 * The application mark, shared by the window icon and the menu bar icon so the two stay one
 * drawing.
 *
 * It is Lucide's `git-pull-request` with the source node grown into a lens: the stroke running down
 * from that node is both the source branch and the handle of a magnifying glass, so the mark reads
 * as "inspect a pull request" without adding any geometry to the icon it came from. It keeps
 * Lucide's 24 unit grid, its 2 unit stroke and the gap it leaves between the source node and the
 * branch, so it sits beside that set without looking foreign.
 *
 * Shapes are described by their centre line and the stroke is added when distance is measured,
 * which is what lets the same description be rasterised at any size.
 */

/** Half of the 2 unit stroke every shape is drawn with. */
const HALF_STROKE = 1;

export interface Point {
	readonly x: number;
	readonly y: number;
}

/** `arc` covers one quadrant of a circle: the one the signs in `quadrant` point into. */
export type Shape =
	| { readonly kind: "ring"; readonly centre: Point; readonly radius: number }
	| { readonly kind: "segment"; readonly from: Point; readonly to: Point }
	| {
			readonly kind: "arc";
			readonly centre: Point;
			readonly radius: number;
			readonly quadrant: Point;
	  };

/** The lens and its handle: what turns a pull request glyph into an instrument. */
export const LENS: readonly Shape[] = [
	{ kind: "ring", centre: { x: 7.4, y: 8.5 }, radius: 5.8 },
	{ kind: "segment", from: { x: 7.4, y: 14.3 }, to: { x: 7.4, y: 21 } },
];

/** The branch leaving the lens and the commit it lands on, both kept from the original icon. */
export const BRANCH: readonly Shape[] = [
	{ kind: "segment", from: { x: 16.7, y: 8.5 }, to: { x: 17, y: 8.5 } },
	{ kind: "arc", centre: { x: 17, y: 10.5 }, radius: 2, quadrant: { x: 1, y: -1 } },
	{ kind: "segment", from: { x: 19, y: 10.5 }, to: { x: 19, y: 15.9 } },
	{ kind: "ring", centre: { x: 19, y: 18.5 }, radius: 2.6 },
];

export const MARK: readonly Shape[] = [...LENS, ...BRANCH];

/** The drawing's extent in grid units, stroke included. */
export const BOUNDS = { left: 0.6, top: 1.7, width: 22, height: 20.4 } as const;

export interface Placement {
	/** Pixels per grid unit. */
	readonly unit: number;
	/** Where the bounding box's top left corner lands, in pixels. */
	readonly originX: number;
	readonly originY: number;
}

/** Centres the mark in a square of `size` pixels, keeping `padding` pixels clear around it. */
export function fit(size: number, padding = 0): Placement {
	const available = size - padding * 2;
	const unit = Math.min(available / BOUNDS.width, available / BOUNDS.height);
	return {
		unit,
		originX: (size - BOUNDS.width * unit) / 2,
		originY: (size - BOUNDS.height * unit) / 2,
	};
}

/** Coverage of `shapes` at a pixel centre, from 0 for clear to 1 for solid. */
export function alphaAt(
	shapes: readonly Shape[],
	placement: Placement,
	pixelX: number,
	pixelY: number,
): number {
	const x = BOUNDS.left + (pixelX - placement.originX) / placement.unit;
	const y = BOUNDS.top + (pixelY - placement.originY) / placement.unit;

	let nearest = Number.POSITIVE_INFINITY;
	for (const shape of shapes) {
		nearest = Math.min(nearest, distance(shape, x, y));
	}

	// One pixel of ramp across the edge, which is all the anti-aliasing a line drawing needs.
	return clamp(0.5 - nearest * placement.unit, 0, 1);
}

/** Distance from a point to a shape's stroke, negative inside it. Grid units throughout. */
function distance(shape: Shape, x: number, y: number): number {
	switch (shape.kind) {
		case "ring": {
			const toCentre = Math.hypot(x - shape.centre.x, y - shape.centre.y);
			return Math.abs(toCentre - shape.radius) - HALF_STROKE;
		}
		case "segment": {
			return segmentDistance(shape.from, shape.to, x, y) - HALF_STROKE;
		}
		default: {
			return arcDistance(shape.centre, shape.radius, shape.quadrant, x, y) - HALF_STROKE;
		}
	}
}

function segmentDistance(from: Point, to: Point, x: number, y: number): number {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const lengthSquared = dx * dx + dy * dy;
	const along =
		lengthSquared === 0 ? 0 : clamp(((x - from.x) * dx + (y - from.y) * dy) / lengthSquared, 0, 1);
	return Math.hypot(x - (from.x + along * dx), y - (from.y + along * dy));
}

/** Inside the arc's quadrant the distance is to the curve; outside it, to the nearer end. */
function arcDistance(centre: Point, radius: number, quadrant: Point, x: number, y: number): number {
	const dx = x - centre.x;
	const dy = y - centre.y;
	if (dx * quadrant.x >= 0 && dy * quadrant.y >= 0) {
		return Math.abs(Math.hypot(dx, dy) - radius);
	}
	const ends = [
		{ x: centre.x, y: centre.y + radius * quadrant.y },
		{ x: centre.x + radius * quadrant.x, y: centre.y },
	];
	return Math.min(...ends.map((end) => Math.hypot(x - end.x, y - end.y)));
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(Math.max(value, low), high);
}
