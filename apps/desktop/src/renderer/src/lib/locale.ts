/**
 * The locale every date, time and number in the window is formatted with. The main process reads
 * it from the operating system's regional settings; until it arrives, the runtime default stands.
 */
let locale: string | undefined;

export function setFormattingLocale(next: string): void {
	locale = next;
}

export function formattingLocale(): string | undefined {
	return locale;
}
