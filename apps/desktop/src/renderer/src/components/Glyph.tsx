import type { Icon } from "@phosphor-icons/react";
import { Tooltip } from "./Tooltip.js";

/** Colour is the second signal after shape, so keep it to the meanings the tokens already carry. */
export type GlyphTone = "accent" | "success" | "warn" | "danger";

/** A marker beside a title is one of a crowd; a glyph standing in a column of its own is not. */
const SIZES = { chip: 13, bare: 16 };

interface GlyphProps {
	icon: Icon;
	/** The tooltip and the screen reader text both; a glyph has no other wording. */
	label: string;
	/** "chip" sits in a tinted square beside a title; "bare" stands alone in its own column. */
	shape?: "chip" | "bare";
	tone?: GlyphTone | undefined;
	/** A colour of its own, for a glyph that names a kind of thing rather than a good or bad one. */
	color?: string | undefined;
}

/**
 * One icon standing in for a word, with the word a hover away. At a hundred rows the eye scans
 * shapes far faster than it reads, which is what buys the space the titles get back.
 */
export function Glyph({
	icon: Symbol,
	label,
	shape = "bare",
	tone,
	color,
}: GlyphProps): React.JSX.Element {
	return (
		<Tooltip
			content={label}
			render={
				<span
					className="glyph"
					data-shape={shape}
					data-tone={tone}
					style={color === undefined ? undefined : { color }}
				/>
			}
		>
			<Symbol size={SIZES[shape]} weight="bold" aria-hidden />
			<span className="visually-hidden">{label}</span>
		</Tooltip>
	);
}
