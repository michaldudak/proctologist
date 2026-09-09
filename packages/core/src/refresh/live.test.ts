import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, type App } from "../app.js";
import { writeConfig } from "../config/file.js";
import { defaultConfig } from "../config/schema.js";

/**
 * The one test that talks to the real `gh`, `git` and `codex`. It costs money and minutes, so it
 * only runs when asked:
 *
 *   PROCTOLOGIST_LIVE=1 PROCTOLOGIST_LIVE_REPO=owner/name \
 *   PROCTOLOGIST_LIVE_CLONE=/path/to/clone pnpm test
 */
const live = process.env["PROCTOLOGIST_LIVE"] === "1";
const repository = process.env["PROCTOLOGIST_LIVE_REPO"] ?? "";
const clone = process.env["PROCTOLOGIST_LIVE_CLONE"];

let home: string;
let app: App;

describe.skipIf(!live || repository === "")("a real refresh", () => {
	beforeAll(async () => {
		home = await mkdtemp(path.join(os.tmpdir(), "proctologist-live-"));
		const configFile = path.join(home, "config.toml");
		await writeConfig(
			{
				...defaultConfig,
				repositories: [
					{
						name: repository,
						owner: repository.split("/")[0] ?? "",
						repo: repository.split("/")[1] ?? "",
						clone,
						codexProfiles: {},
					},
				],
			},
			{ configFile },
		);
		app = await createApp({
			configFile,
			homeDir: home,
			env: {},
			databaseFile: path.join(home, "data.sqlite"),
		});
	}, 60_000);

	afterAll(async () => {
		await app?.close();
		await rm(home, { recursive: true, force: true });
	});

	it(
		"fetches the open pull requests and assesses them",
		async () => {
			const result = await app.refresh.runRefresh(repository);

			expect(result.outcome).toBe("completed");
			expect(result.counts.fetched).toBeGreaterThan(0);
			expect(result.counts.reassessed).toBeGreaterThan(0);

			const stored = app.store.assessments.currentForRepository(repository);
			expect(stored.length).toBeGreaterThan(0);
			expect(stored.every((assessment) => assessment.verdict !== null)).toBe(true);
		},
		30 * 60_000,
	);
});
