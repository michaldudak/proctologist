/**
 * Layout the two processes have to agree on. macOS draws the window buttons itself, outside the
 * page, so the main process has to be told where the header they sit in ends, and the renderer has
 * to be told how far in its own content can start.
 */

/** Pixels. The renderer sets `--app-header-height` from this. */
export const HEADER_HEIGHT = 48;

/** macOS draws its window buttons 12pt tall, and the three of them 52pt wide. */
const WINDOW_BUTTON_HEIGHT = 12;
const WINDOW_BUTTONS_WIDTH = 52;

/**
 * Where the window buttons go, measured from the top left of the window. Left of the default so
 * they clear the header's own padding, and far enough down to sit on the header's centre line
 * rather than near the top of it, which is where a hidden title bar would otherwise leave them.
 */
export const WINDOW_BUTTON_POSITION = {
	x: 20,
	y: (HEADER_HEIGHT - WINDOW_BUTTON_HEIGHT) / 2,
};

/**
 * Where the header's own content can start. The gap past the buttons is wide enough that the title
 * reads as the app's, not as a fourth button. The renderer sets `--app-header-inset` from this.
 */
export const HEADER_INSET = WINDOW_BUTTON_POSITION.x + WINDOW_BUTTONS_WIDTH + 28;
