import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseModelCatalog, type CodexModel } from "./models.js";

const run = promisify(execFile);

export interface CatalogOptions {
	codexPath?: string;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}

/**
 * Asks the Codex CLI which models and reasoning levels it accepts.
 *
 * Reading them from Codex rather than hardcoding a list is the whole point: the models change with
 * every Codex release, and which efforts a model takes differs between them.
 */
export async function readModelCatalog(options: CatalogOptions = {}): Promise<CodexModel[]> {
	const { stdout } = await run(options.codexPath ?? "codex", ["debug", "models"], {
		env: options.env ?? process.env,
		timeout: options.timeoutMs ?? 15_000,
		maxBuffer: 32 * 1024 * 1024,
	});

	return parseModelCatalog(stdout);
}
