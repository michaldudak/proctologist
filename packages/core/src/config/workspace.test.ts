import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseConfig } from "./schema.js";
import { createEphemeralWorkspace, type EphemeralWorkspace } from "./workspace.js";

let homeDir: string;
let parentDir: string;
let workspace: EphemeralWorkspace | undefined;

beforeEach(async () => {
	homeDir = await mkdtemp(path.join(os.tmpdir(), "proctologist-home-"));
	parentDir = await mkdtemp(path.join(os.tmpdir(), "proctologist-workspaces-"));
});

afterEach(async () => {
	workspace?.remove();
	workspace = undefined;
	await rm(homeDir, { recursive: true, force: true });
	await rm(parentDir, { recursive: true, force: true });
});

function options() {
	return { homeDir, parentDir, env: {}, platform: "darwin" as const };
}

async function writeRealConfig(text: string): Promise<void> {
	const dir = path.join(homeDir, ".config", "proctologist");
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "config.toml"), text, "utf8");
}

function create(): EphemeralWorkspace {
	workspace = createEphemeralWorkspace(options());
	return workspace;
}

describe("createEphemeralWorkspace", () => {
	it("puts the config, the database and the cache under one folder of its own", () => {
		const created = create();

		expect(created.dir.startsWith(parentDir)).toBe(true);
		expect(created.paths.configDir).toBe(path.join(created.dir, "config"));
		expect(created.paths.databaseFile).toBe(path.join(created.dir, "data", "data.sqlite"));
		expect(existsSync(created.paths.cacheDir)).toBe(true);
	});

	it("gives every instance a workspace of its own", () => {
		const first = createEphemeralWorkspace(options());
		const second = createEphemeralWorkspace(options());

		try {
			expect(first.dir).not.toBe(second.dir);
		} finally {
			first.remove();
			second.remove();
		}
	});

	it("copies the tracked repositories, so there is something to work on straight away", async () => {
		await writeRealConfig(`
			concurrency = 3

			[[repositories]]
			name = "owner/name"
			clone = "/tmp/clone"
		`);

		const created = create();
		const config = parseConfig(readFileSync(created.paths.configFile, "utf8"));

		expect(config.concurrency).toBe(3);
		expect(config.repositories.map((entry) => entry.name)).toEqual(["owner/name"]);
		expect(created.problem).toBeNull();
	});

	// The whole point of a workspace is that the real database is out of reach from inside it.
	it("does not carry over a data_dir pointing at the real database", async () => {
		await writeRealConfig(`data_dir = "~/Library/Application Support/PRoctologist"\n`);

		const created = create();

		expect(readFileSync(created.paths.configFile, "utf8")).not.toContain("data_dir");
		expect(created.paths.dataDir).toBe(path.join(created.dir, "data"));
	});

	it("starts with an empty database, whatever the real one holds", async () => {
		await writeRealConfig(`concurrency = 3\n`);

		expect(existsSync(create().paths.databaseFile)).toBe(false);
	});

	it("leaves out what this build cannot read, and says what it left out", async () => {
		await writeRealConfig(`
			concurrency = 3
			telemetry_endpoint = "https://example.test"
		`);

		const created = create();

		expect(created.ignored).toEqual(["telemetry_endpoint"]);
		expect(parseConfig(readFileSync(created.paths.configFile, "utf8")).concurrency).toBe(3);
	});

	it("starts anyway when there is no config to copy", () => {
		const created = create();

		expect(created.problem).toBeNull();
		expect(existsSync(created.paths.configFile)).toBe(false);
	});

	it("starts anyway when the config cannot be read at all, and says why", async () => {
		await writeRealConfig("this is not = = toml\n");

		const created = create();

		expect(created.problem).toContain("Could not parse");
		expect(existsSync(created.paths.configFile)).toBe(false);
	});

	// Chromium writes its own files back as it shuts down, after the app has deleted the workspace
	// and after the last hook it can run, so the husk it leaves has to be swept from the next run.
	it("sweeps away what an earlier instance could not delete", async () => {
		const husk = path.join(parentDir, "proctologist-workspace-gone");
		await mkdir(path.join(husk, "electron"), { recursive: true });

		create();

		expect(existsSync(husk)).toBe(false);
	});

	it("leaves a workspace that still holds its folders, which may be in use", async () => {
		const other = path.join(parentDir, "proctologist-workspace-busy");
		for (const folder of ["config", "data", "cache"]) {
			// oxlint-disable-next-line no-await-in-loop
			await mkdir(path.join(other, folder), { recursive: true });
		}

		create();

		expect(existsSync(other)).toBe(true);
	});

	it("leaves alone anything in the folder that is not a workspace", async () => {
		const stranger = path.join(parentDir, "proctologist-config-abc");
		await mkdir(stranger, { recursive: true });

		create();

		expect(existsSync(stranger)).toBe(true);
	});

	it("takes the whole workspace away with it", () => {
		const created = create();

		created.remove();

		expect(existsSync(created.dir)).toBe(false);
		// Quitting twice, or quitting after a crash cleaned up, must not be an error.
		expect(() => created.remove()).not.toThrow();
	});
});
