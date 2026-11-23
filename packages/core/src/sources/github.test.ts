import { expect, it } from "vitest";
import { createGitHubProvider } from "./github.js";
import { createGitHubClient } from "../github/client.js";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
it("distinguishes merging a PR from closing it and refuses an unknown issue outcome", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "source-provider-"));
	try {
		const ghPath = path.join(dir, "gh");
		await writeFile(
			ghPath,
			`#!/usr/bin/env node\nconst route = process.argv.at(-1); console.log(JSON.stringify(route.endsWith('/1') ? {state:'closed',merged:true,title:'Merged',html_url:'https://github.com/a/b/pull/1'} : route.endsWith('/2') ? {state:'closed',merged:false} : {state:'closed',state_reason:null}));\n`,
		);
		await chmod(ghPath, 0o755);
		const provider = createGitHubProvider(createGitHubClient({ ghPath }));
		const source = { id: "source", provider: "github", locator: "a/b", active: true };
		expect(
			await provider.readState(source, { kind: "pull_request", externalId: "1" }),
		).toMatchObject({ state: "closed", outcome: "successful" });
		expect(
			await provider.readState(source, { kind: "pull_request", externalId: "2" }),
		).toMatchObject({ state: "closed", outcome: "other" });
		expect(await provider.readState(source, { kind: "issue", externalId: "3" })).toMatchObject({
			state: "closed",
			outcome: "unknown",
		});
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
