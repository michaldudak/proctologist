/**
 * The locale every date, time and number in the window is formatted with. The main process reads
 * it from the operating system's regional settings; until it arrives, the runtime default stands.
 */
let locale: string | undefined;

export function setFormattingLocale(next: string): void {
	locale = normalizeLocale(next);
}

/** Back to the runtime default, as if the operating system had never reported a locale. */
export function resetFormattingLocale(): void {
	locale = undefined;
}

export function formattingLocale(): string | undefined {
	return locale;
}

/**
 * macOS reports a region override the POSIX way: `en-US@rg=dezzzz` means English text with German
 * regional formats. Intl rejects that spelling outright, so the override region replaces the
 * tag's own (`en-DE`) and every other modifier is dropped. `Intl.Locale` knows where the region
 * sits among script, variant and extension subtags, so those survive untouched. A tag Intl still
 * rejects becomes undefined — the runtime default — rather than kept, so a strange locale can
 * never take the window down with a RangeError.
 */
export function normalizeLocale(tag: string): string | undefined {
	const [base = "", modifiers = ""] = tag.split("@", 2);
	// UTS #35 lets the override region be two letters or three digits.
	const override = /(?:^|;)rg=([a-z]{2}|\d{3})zzzz(?:;|$)/i.exec(modifiers)?.[1];
	try {
		return new Intl.Locale(base, override === undefined ? {} : { region: override }).toString();
	} catch {
		return undefined;
	}
}
