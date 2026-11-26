import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, defaultConfig, parseConfig } from "./schema.js";
import { loadConfig, watchConfig, writeConfig } from "./file.js";

let homeDir: string;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(os.tmpdir(), "proctologist-config-"));
});

afterEach(async () => {
	await rm(homeDir, { recursive: true, force: true });
});

function options() {
	return { homeDir, env: {}, platform: "darwin" as const };
}

async function writeConfigFile(text: string): Promise<string> {
	const dir = path.join(homeDir, ".config", "proctologist");
	await mkdir(dir, { recursive: true });
	const file = path.join(dir, "config.toml");
	await writeFile(file, text, "utf8");
	return file;
}

describe("loadConfig", () => {
	it("returns the defaults when no config file exists", async () => {
		const loaded = await loadConfig(options());

		expect(loaded.exists).toBe(false);
		expect(loaded.config).toEqual(defaultConfig);
		expect(loaded.paths.configFile).toBe(path.join(homeDir, ".config/proctologist/config.toml"));
	});

	it("reads an existing config file", async () => {
		await writeConfigFile("concurrency = 2\n");

		const loaded = await loadConfig(options());

		expect(loaded.exists).toBe(true);
		expect(loaded.config.concurrency).toBe(2);
	});

	it("applies data_dir to the database location", async () => {
		await writeConfigFile(`data_dir = "~/pr-data"\n`);

		const loaded = await loadConfig(options());

		expect(loaded.paths.databaseFile).toBe(path.join(homeDir, "pr-data", "data.sqlite"));
		expect(loaded.paths.cacheDir).toBe(path.join(homeDir, "Library", "Caches", "PRoctologist"));
	});

	it("reads a config file given explicitly", async () => {
		const file = path.join(homeDir, "elsewhere.toml");
		await writeFile(file, "concurrency = 4\n", "utf8");

		const loaded = await loadConfig({ ...options(), configFile: file });

		expect(loaded.config.concurrency).toBe(4);
		expect(loaded.paths.configFile).toBe(file);
		expect(loaded.paths.configDir).toBe(homeDir);
	});

	it("reports an invalid config file as a ConfigError naming the file", async () => {
		const file = await writeConfigFile("concurrency = 0\n");

		await expect(loadConfig(options())).rejects.toThrow(ConfigError);
		await expect(loadConfig(options())).rejects.toThrow(file);
	});
});

describe("writeConfig", () => {
	it("creates the config directory and writes a readable file", async () => {
		const config = parseConfig(`
			concurrency = 3

			[[repositories]]
			name = "owner/thing"
			clone = "~/code/thing"
		`);

		await writeConfig(config, options());

		expect((await loadConfig(options())).config).toEqual(config);
	});

	it("replaces an existing file", async () => {
		await writeConfigFile("concurrency = 2\n");

		await writeConfig({ ...defaultConfig, concurrency: 5 }, options());

		expect((await loadConfig(options())).config.concurrency).toBe(5);
	});

	it("leaves no temporary files behind", async () => {
		await writeConfig(defaultConfig, options());

		const { readdir } = await import("node:fs/promises");
		const entries = await readdir(path.join(homeDir, ".config", "proctologist"));
		expect(entries).toEqual(["config.toml"]);
	});
});

/*
 * A filesystem event has no deadline: it crosses the watch, a debounce and a read before the
 * callback runs, and on a loaded machine running the whole suite at once that took longer than
 * waitFor's default second. The wait is generous rather than tight because nothing here is
 * measuring how quickly the watcher reacts, only that it does.
 */
const EVENTUALLY = { timeout: 15_000 };

/**
 * Long enough that two writes in a row land inside one window even when the worker is starved,
 * which is what the collapsing into a single call rests on.
 */
const DEBOUNCE_MS = 100;

/**
 * Writes the config file until the watcher reports it. macOS can fold a write made just before the
 * watcher started into the ones made just after and deliver none of them, so a single write right
 * after `watchConfig` returns is not sure to be seen, least of all on a machine busy with other
 * files. Writing the same text again costs nothing and gets past that.
 */
async function writeUntil(text: string, reported: () => void, debounceMs: number): Promise<void> {
	await vi.waitFor(
		async () => {
			await writeConfigFile(text);
			await sleep(debounceMs * 2);
			reported();
		},
		{ ...EVENTUALLY, interval: debounceMs },
	);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

// Longer than EVENTUALLY, so a watcher that never reports fails on the expectation that says so.
describe("watchConfig", { timeout: 20_000 }, () => {
	it("reports the config after a change, debounced into one call", async () => {
		await writeConfigFile("concurrency = 2\n");
		const onChange = vi.fn();
		const watcher = await watchConfig({ ...options(), debounceMs: DEBOUNCE_MS, onChange });
		const reported = (): number[] =>
			onChange.mock.calls.map(([loaded]) => loaded.config.concurrency);

		try {
			await writeUntil("concurrency = 2\n", () => expect(onChange).toHaveBeenCalled(), DEBOUNCE_MS);
			// Lets the last of those writes be reported, so no reload is pending between the next two.
			await sleep(DEBOUNCE_MS * 3);

			await writeConfigFile("concurrency = 3\n");
			await writeConfigFile("concurrency = 4\n");

			await vi.waitFor(() => expect(reported().at(-1)).toBe(4), EVENTUALLY);
			// The two writes fell in one window, so the first was never reported on its own.
			expect(reported()).not.toContain(3);
		} finally {
			await watcher.close();
		}
	});

	it("reports a broken config file to onError instead of throwing", async () => {
		await writeConfigFile("concurrency = 2\n");
		const onChange = vi.fn();
		const onError = vi.fn();
		const watcher = await watchConfig({ ...options(), debounceMs: 20, onChange, onError });

		try {
			await writeUntil("concurrency = 0\n", () => expect(onError).toHaveBeenCalled(), 20);

			expect(onError.mock.lastCall?.[0]).toBeInstanceOf(ConfigError);
			expect(onChange).not.toHaveBeenCalled();
		} finally {
			await watcher.close();
		}
	});

	it("notices a config file that did not exist when watching started", async () => {
		const onChange = vi.fn();
		const watcher = await watchConfig({ ...options(), debounceMs: 20, onChange });

		try {
			await writeConfigFile("concurrency = 7\n");

			await vi.waitFor(() => {
				expect(onChange.mock.lastCall?.[0].config.concurrency).toBe(7);
			}, EVENTUALLY);
		} finally {
			await watcher.close();
		}
	});

	it("stops reporting once closed", async () => {
		const onChange = vi.fn();
		const watcher = await watchConfig({ ...options(), debounceMs: 20, onChange });
		await watcher.close();

		await writeConfigFile("concurrency = 7\n");
		await new Promise((resolve) => setTimeout(resolve, 80));

		expect(onChange).not.toHaveBeenCalled();
	});
});
