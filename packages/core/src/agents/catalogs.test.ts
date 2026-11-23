import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readClaudeModelCache } from "./catalogs.js";

describe("readClaudeModelCache", () => {
	let configDir: string;
	let cacheDir: string;

	beforeEach(async () => {
		configDir = await mkdtemp(path.join(os.tmpdir(), "proctologist-claude-"));
		cacheDir = path.join(configDir, "cache", "model-catalog");
		await mkdir(cacheDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(configDir, { recursive: true, force: true });
	});

	async function write(file: string, content: string, ageSeconds = 0): Promise<void> {
		const target = path.join(cacheDir, file);
		await writeFile(target, content);
		const at = Date.now() / 1000 - ageSeconds;
		await utimes(target, at, at);
	}

	it("reads the catalog the floor index names as freshest", async () => {
		await write(
			"published-floor.json",
			JSON.stringify({ sources: { old: { recordedAt: 1 }, new: { recordedAt: 2 } } }),
		);
		await write("published-old.json", "old");
		await write("published-new.json", "new");

		expect(await readClaudeModelCache({ claudeConfigDir: configDir })).toBe("new");
	});

	it("finds a per-surface file when the index names one that is gone", async () => {
		await write("published-floor.json", JSON.stringify({ sources: { gone: { recordedAt: 1 } } }));
		await write("org-hash-ccd.json", "desktop");

		expect(await readClaudeModelCache({ claudeConfigDir: configDir })).toBe("desktop");
	});

	it("prefers Claude Code's own surface, even over a fresher one from the desktop app", async () => {
		await write("org-hash-cc.json", "cli", 3600);
		await write("org-hash-ccd.json", "desktop");

		expect(await readClaudeModelCache({ claudeConfigDir: configDir })).toBe("cli");
	});

	it("takes the most recently written file of a surface", async () => {
		await write("tok-a-ccd.json", "older", 3600);
		await write("org-b-ccd.json", "newer");

		expect(await readClaudeModelCache({ claudeConfigDir: configDir })).toBe("newer");
	});

	it("comes up empty when there is no cache at all", async () => {
		await rm(cacheDir, { recursive: true });

		expect(await readClaudeModelCache({ claudeConfigDir: configDir })).toBeUndefined();
	});
});
