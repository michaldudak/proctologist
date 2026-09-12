/**
 * The locale every date, time and number in the window is formatted with. The main process reads
 * it from the operating system's regional settings; until it arrives, the runtime default stands.
 */
let locale: string | undefined;

export function setFormattingLocale(next: string): void {
	locale = normalizeLocale(next);
}

export function formattingLocale(): string | undefined {
	return locale;
}

/**
 * macOS reports a region override the POSIX way: `en-US@rg=dezzzz` means English text with German
 * regional formats. Intl rejects that spelling outright, so the override region replaces the
 * tag's own (`en-DE`) and every other modifier is dropped. A tag Intl still rejects becomes
 * undefined — the runtime default — rather than kept, so a strange locale can never take the
 * window down with a RangeError.
 */
export function normalizeLocale(tag: string): string | undefined {
	const [base = "", modifiers = ""] = tag.split("@", 2);
	const override = /(?:^|;)rg=([a-z]{2})zzzz(?:;|$)/i.exec(modifiers)?.[1];
	const subtags = base.split("-").filter((part) => part !== "");

	if (override === undefined) {
		return validate(subtags.join("-"));
	}
	// The region subtag (two letters or three digits, never in the language position) gives way
	// to the override; language, script and the rest stay.
	const kept = subtags.filter((part, index) => index === 0 || !/^([a-z]{2}|\d{3})$/i.test(part));
	return validate([...kept, override.toUpperCase()].join("-"));
}

function validate(candidate: string): string | undefined {
	try {
		return Intl.getCanonicalLocales(candidate)[0];
	} catch {
		return undefined;
	}
}
