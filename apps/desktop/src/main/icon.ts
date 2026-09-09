import { nativeImage, type NativeImage } from "electron";

const SIZE = 16;

/**
 * The tray icon is drawn in code rather than shipped as a file: it is a handful of rectangles, and
 * keeping it here means it can be adjusted without a binary asset in the repository.
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

	const fill = (x: number, y: number, width: number, height: number): void => {
		for (let row = y; row < y + height; row += 1) {
			for (let column = x; column < x + width; column += 1) {
				if (row < 0 || row >= size || column < 0 || column >= size) {
					continue;
				}
				const offset = (row * size + column) * 4;
				buffer[offset] = 0;
				buffer[offset + 1] = 0;
				buffer[offset + 2] = 0;
				buffer[offset + 3] = 255;
			}
		}
	};

	// Three checklist rows: a marker on the left, a line to its right.
	for (const [index, length] of [10, 10, 7].entries()) {
		const y = (3 + index * 4) * scale;
		fill(2 * scale, y, 2 * scale, 2 * scale);
		fill(6 * scale, y, length * scale - 4 * scale, 2 * scale);
	}

	if (options.unviewed) {
		// A dot in the corner, with a gap punched around it so it reads against the rows.
		clear(buffer, size, (SIZE - 6) * scale, 0, 6 * scale, 6 * scale);
		fill((SIZE - 5) * scale, scale, 4 * scale, 4 * scale);
	}

	return buffer;
}

function clear(
	buffer: Buffer,
	size: number,
	x: number,
	y: number,
	width: number,
	height: number,
): void {
	for (let row = y; row < y + height; row += 1) {
		for (let column = x; column < x + width; column += 1) {
			if (row < 0 || row >= size || column < 0 || column >= size) {
				continue;
			}
			buffer.fill(0, (row * size + column) * 4, (row * size + column) * 4 + 4);
		}
	}
}
