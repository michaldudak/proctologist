import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { writeConfig } from "../config/file.js";
import { defaultConfig } from "../config/schema.js";
const ghPath = fileURLToPath(new URL("../github/__fixtures__/fake-gh.mjs", import.meta.url));
const codex = fileURLToPath(new URL("../agents/__fixtures__/fake-codex.mjs", import.meta.url));
it("runs suggestions through the CLI job boundary, validates links, accepts separately and supports abort", async () => {
	const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "task-job-"));
	vi.stubEnv("FAKE_GH_DIR", fileURLToPath(new URL("../github/__fixtures__", import.meta.url)));
	const capture = path.join(workspaceDir, "prompt.json");
	vi.stubEnv("FAKE_CODEX_ARGS_OUT", capture);
	await writeConfig(
		{
			...defaultConfig,
			repositories: [
				{ name: "owner/thing", owner: "owner", repo: "thing", issues: false, profiles: {} },
			],
		},
		{ workspaceDir },
	);
	const app = await createApp({ workspaceDir, ghPath, agentPaths: { codex } });
	try {
		await app.jobs.wait(app.startRefresh("owner/thing").id);
		const selected = app.store.sources.items()[0]!;
		expect(selected).toBeDefined();
		app.store.notes.set(
			{ repository: "owner/thing", number: Number(selected.externalId) },
			"PRIVATE ITEM NOTE",
			new Date().toISOString(),
		);
		app.store.tasks.create({
			title: "Already working",
			itemIds: [selected.id],
			note: "PRIVATE TASK NOTE",
		});
		vi.stubEnv(
			"FAKE_CODEX_MESSAGE",
			JSON.stringify({
				suggestions: [{ title: "Write a regression test", itemIds: [selected.id] }],
			}),
		);
		const job = await app.jobs.wait(app.startTaskSuggestions([selected.id]).id);
		expect(job.state, job.error ?? "").toBe("completed");
		const captured = await readFile(capture, "utf8");
		expect(captured).toContain("Already working");
		expect(captured).not.toContain("PRIVATE ITEM NOTE");
		expect(captured).not.toContain("PRIVATE TASK NOTE");
		expect(app.store.tasks.list()).toHaveLength(1);
		expect(app.store.taskSuggestions.get(job.id)?.suggestions).toHaveLength(1);
		vi.stubEnv(
			"FAKE_CODEX_MESSAGE",
			JSON.stringify({ suggestions: [{ title: "Bad link", itemIds: ["invented"] }] }),
		);
		expect((await app.jobs.wait(app.startTaskSuggestions([selected.id]).id)).state).toBe("failed");
		const aborted = app.startTaskSuggestions([selected.id]);
		app.jobs.abort(aborted.id);
		expect((await app.jobs.wait(aborted.id)).state).toBe("aborted");
		expect(app.store.tasks.list()).toHaveLength(1);
	} finally {
		await app.close();
		vi.unstubAllEnvs();
		await rm(workspaceDir, { recursive: true, force: true });
	}
});
