import { nativeImage, type NativeImage } from "electron";
import { alphaAt, fit, MARK } from "./mark.js";

const SIZE = 16;
/** A little air so the mark does not touch the edges of its slot in the menu bar. */
const PADDING = 0.5;

/**
 * The tray icon is drawn in code rather than shipped as a file, from the same description as the
 * application icon in ./mark.ts, so the two cannot drift apart.
 */
export interface IconOptions {
	/** Adds the dot that marks assessments the user has not looked at yet. */
	unviewed?: boolean;
}

export function trayIcon(options: IconOptions = {}): NativeImage {
	const image = nativeImage.createFromBuffer(bitmap(1, options), {
		width: SIZE,
		height: SIZE,
		scaleFactor: 1,
	});
	image.addRepresentation({
		scaleFactor: 2,
		width: SIZE * 2,
		height: SIZE * 2,
		buffer: bitmap(2, options),
	});
	// A template image is tinted by macOS to match the menu bar, light or dark.
	image.setTemplateImage(true);
	return image;
}

/** Bitmaps are BGRA, premultiplied, top row first. */
function bitmap(scale: number, options: IconOptions): Buffer {
	const size = SIZE * scale;
	const buffer = Buffer.alloc(size * size * 4);
	const placement = fit(size, PADDING * scale);

	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) {
			const alpha = alphaAt(MARK, placement, column + 0.5, row + 0.5);
			if (alpha > 0) {
				// Template images carry their shape in the alpha channel and macOS supplies the
				// colour, so the premultiplied colour channels stay at zero.
				buffer[(row * size + column) * 4 + 3] = Math.round(alpha * 255);
			}
		}
	}

	if (options.unviewed) {
		addUnviewedDot(buffer, size, scale);
	}

	return buffer;
}

/**
 * A dot in the top right, with a gap punched around it so it reads against the mark.
 *
 * It sits in the corner the branch leaves clear above its elbow, which is the only room the mark
 * has to spare: a wider gap than this eats into the branch and the drawing stops making sense.
 */
function addUnviewedDot(buffer: Buffer, size: number, scale: number): void {
	const radius = 1.75 * scale;
	const centreX = size - radius - 0.75 * scale;
	const centreY = radius + 0.5 * scale;

	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) {
			const away = Math.hypot(column + 0.5 - centreX, row + 0.5 - centreY);
			const offset = (row * size + column) * 4;
			if (away <= radius + 0.6 * scale) {
				buffer[offset + 3] = 0;
			}
			const alpha = Math.min(Math.max(0.5 - (away - radius), 0), 1);
			if (alpha > 0) {
				buffer[offset + 3] = Math.round(alpha * 255);
			}
		}
	}
}
