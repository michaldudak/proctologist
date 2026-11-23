import { planTasks, weekStart } from "@proctologist/core/browser";
import { afterEach, describe, expect, it } from "vitest";
import {
	formattingLocale,
	normalizeLocale,
	resetFormattingLocale,
	setFormattingLocale,
} from "./locale.js";

describe("normalizeLocale", () => {
	it("moves a macOS region override into the tag", () => {
		expect(normalizeLocale("en-US@rg=dezzzz")).toBe("en-DE");
		expect(normalizeLocale("en-US@rg=USZZZZ")).toBe("en-US");
	});

	it("keeps a script subtag while replacing the region", () => {
		expect(normalizeLocale("zh-Hans-CN@rg=uszzzz")).toBe("zh-Hans-US");
	});

	it("adds the override region when the base tag has none", () => {
		expect(normalizeLocale("en@rg=dezzzz")).toBe("en-DE");
	});

	it("keeps variants and extensions around the replaced region", () => {
		expect(normalizeLocale("en-US-u-ca-gregory@rg=dezzzz")).toBe("en-DE-u-ca-gregory");
		expect(normalizeLocale("de-DE-1996@rg=atzzzz")).toBe("de-AT-1996");
	});

	it("accepts a three-digit override region", () => {
		expect(normalizeLocale("en-US@rg=419zzzz")).toBe("en-419");
	});

	it("drops modifiers it does not understand", () => {
		expect(normalizeLocale("en-US@calendar=gregorian")).toBe("en-US");
		expect(normalizeLocale("de-DE@rg=dezzzz;calendar=gregorian")).toBe("de-DE");
	});

	it("leaves a plain tag alone", () => {
		expect(normalizeLocale("de-DE")).toBe("de-DE");
		expect(normalizeLocale("en")).toBe("en");
	});

	it("turns a tag Intl rejects into undefined instead of keeping it", () => {
		expect(normalizeLocale("not a locale")).toBeUndefined();
		expect(normalizeLocale("")).toBeUndefined();
	});

	it("feeds every date, time and number formatter without throwing", () => {
		const tag = normalizeLocale("en-US@rg=dezzzz");
		expect(new Date().toLocaleTimeString(tag, { timeStyle: "short" })).toBeTruthy();
		expect((1286).toLocaleString(tag)).toBe("1.286");
	});
});

describe("setFormattingLocale", () => {
	afterEach(resetFormattingLocale);

	it("stores the normalized tag", () => {
		setFormattingLocale("en-US@rg=dezzzz");
		expect(formattingLocale()).toBe("en-DE");
	});

	it("falls back to the runtime default for a tag Intl rejects", () => {
		setFormattingLocale("not a locale");
		expect(formattingLocale()).toBeUndefined();
	});
});

describe("Task planning and suggestion dates", () => {
	afterEach(resetFormattingLocale);
	it.each(["en-US@rg=dezzzz", "not a locale"])("uses the normalized locale for %s", (raw) => {
		setFormattingLocale(raw);
		const tag = formattingLocale();
		expect(() => planTasks([], "week", "2026-09-16", tag)).not.toThrow();
		expect(() => new Date("2026-09-16T12:00:00Z").toLocaleString(tag)).not.toThrow();
		if (raw.includes("rg=")) expect(weekStart("2026-09-16", tag)).toBe("2026-09-14");
	});
});
