#!/usr/bin/env node
// Draws the application icon and writes build/icon.png. Run with `pnpm run icon`.
// Written by hand rather than exported from a design tool so the icon stays in version control as
// something a reader can change.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import path from "node:path";

const CRC_TABLE = Array.from({ length: 256 }, (_unused, index) => {
	let value = index;
	for (let bit = 0; bit < 8; bit += 1) {
		value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
	}
	return value >>> 0;
});

const SIZE = 1024;
const BACKGROUND = [24, 27, 33];
const BAR = [237, 240, 245];
const ACCENT = [86, 156, 246];

const pixels = Buffer.alloc(SIZE * SIZE * 4);

function set(x, y, [r, g, b], alpha = 255) {
	if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
		return;
	}
	const offset = (y * SIZE + x) * 4;
	// Composite onto whatever is there, so anti-aliased edges blend.
	const existing = pixels[offset + 3] / 255;
	const a = alpha / 255;
	const out = a + existing * (1 - a);
	if (out === 0) {
		return;
	}
	for (const [index, value] of [r, g, b].entries()) {
		pixels[offset + index] = Math.round(
			(value * a + pixels[offset + index] * existing * (1 - a)) / out,
		);
	}
	pixels[offset + 3] = Math.round(out * 255);
}

/** Coverage of a rounded rectangle at a point, sampled to soften the edges. */
function roundedRectCoverage(x, y, left, top, width, height, radius) {
	let hits = 0;
	for (const dx of [0.25, 0.75]) {
		for (const dy of [0.25, 0.75]) {
			const px = x + dx;
			const py = y + dy;
			if (px < left || py < top || px > left + width || py > top + height) {
				continue;
			}
			const cx = Math.min(Math.max(px, left + radius), left + width - radius);
			const cy = Math.min(Math.max(py, top + radius), top + height - radius);
			if ((px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2) {
				hits += 1;
			}
		}
	}
	return hits / 4;
}

function fillRounded(left, top, width, height, radius, colour) {
	for (let y = Math.floor(top); y < Math.ceil(top + height); y += 1) {
		for (let x = Math.floor(left); x < Math.ceil(left + width); x += 1) {
			const coverage = roundedRectCoverage(x, y, left, top, width, height, radius);
			if (coverage > 0) {
				set(x, y, colour, Math.round(coverage * 255));
			}
		}
	}
}

// macOS applies its own mask, so the artwork sits inside the usual safe area.
const margin = SIZE * 0.09;
fillRounded(margin, margin, SIZE - margin * 2, SIZE - margin * 2, SIZE * 0.22, BACKGROUND);

// The same checklist as the menu bar icon: a marker and a line, three times over.
const rows = [
	{ length: 0.46, colour: ACCENT },
	{ length: 0.46, colour: BAR },
	{ length: 0.3, colour: BAR },
];
const markerSize = SIZE * 0.09;
const gap = SIZE * 0.155;
const firstTop = SIZE * 0.3;
const markerLeft = SIZE * 0.24;
const barLeft = SIZE * 0.4;

for (const [index, row] of rows.entries()) {
	const top = firstTop + index * gap;
	fillRounded(markerLeft, top, markerSize, markerSize, markerSize * 0.28, row.colour);
	fillRounded(barLeft, top, SIZE * row.length, markerSize, markerSize * 0.28, row.colour);
}

writeFileSync(path.join(import.meta.dirname, "..", "build", "icon.png"), png(pixels));
process.stdout.write("Wrote build/icon.png\n");

function png(rgba) {
	const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
	for (let y = 0; y < SIZE; y += 1) {
		raw[y * (SIZE * 4 + 1)] = 0;
		rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
	}

	const header = Buffer.alloc(13);
	header.writeUInt32BE(SIZE, 0);
	header.writeUInt32BE(SIZE, 4);
	header[8] = 8;
	header[9] = 6;

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

function chunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body), 0);
	return Buffer.concat([length, body, crc]);
}

function crc32(buffer) {
	let crc = 0xff_ff_ff_ff;
	for (const byte of buffer) {
		crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xff_ff_ff_ff) >>> 0;
}
