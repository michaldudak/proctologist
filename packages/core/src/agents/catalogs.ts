import { execFile } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { claudeCatalog } from "./claude.js";
import { parseCodexCatalog } from "./codex.js";
import { emptyCatalog, type AgentCatalog } from "./catalog.js";
import { AGENT_EXECUTABLES, AGENT_KINDS, AGENT_LABELS, type AgentKind } from "./types.js";

const run = promisify(execFile);

export interface CatalogOptions {
	agentPaths?: Partial<Record<AgentKind, string>> | undefined;
	env?: NodeJS.ProcessEnv | undefined;
	timeoutMs?: number | undefined;
	/** Where Claude Code keeps its own state; defaults to `CLAUDE_CONFIG_DIR` or `~/.claude`. */
	claudeConfigDir?: string | undefined;
}

/**
 * Asks one installed agent which models and effort levels it accepts. A missing or unhappy agent
 * is not an error: the catalog comes back empty with a reason, and the settings screen falls back
 * to free text rather than refusing to open.
 */
export async function readAgentCatalog(
	agent: AgentKind,
	options: CatalogOptions = {},
): Promise<AgentCatalog> {
	try {
		return agent === "codex" ? await readCodex(options) : await readClaude(options);
	} catch (cause) {
		return emptyCatalog(
			agent,
			cause instanceof Error
				? `Could not ask ${AGENT_LABELS[agent]} what it can do: ${cause.message}`
				: `Could not ask ${AGENT_LABELS[agent]} what it can do.`,
		);
	}
}

/** Every installed agent's catalog, asked for at once because the settings screen wants them all. */
export async function readAgentCatalogs(
	options: CatalogOptions = {},
): Promise<Record<AgentKind, AgentCatalog>> {
	const catalogs = await Promise.all(AGENT_KINDS.map((agent) => readAgentCatalog(agent, options)));
	return Object.fromEntries(catalogs.map((catalog) => [catalog.agent, catalog])) as Record<
		AgentKind,
		AgentCatalog
	>;
}

async function readCodex(options: CatalogOptions): Promise<AgentCatalog> {
	const { stdout } = await ask("codex", ["debug", "models"], options);
	return parseCodexCatalog(stdout);
}

/**
 * Claude Code has no `debug models` of its own. Its effort levels are in `--help`, and its models
 * are in the catalog it caches for its own picker — so both come from the installed binary rather
 * than from a list written down here, but only the first of those is a supported interface.
 */
async function readClaude(options: CatalogOptions): Promise<AgentCatalog> {
	const [help, version] = await Promise.all([
		ask("claude", ["--help"], options),
		ask("claude", ["--version"], options).catch(() => ({ stdout: "" })),
	]);

	return claudeCatalog({
		help: help.stdout,
		version: version.stdout,
		catalog: await readClaudeModelCache(options),
	});
}

/**
 * Reads the model catalog Claude Code caches under its config directory. This is its own private
 * cache, not an interface it offers, so every step here is allowed to come up empty: a fresh
 * install has not fetched one yet, and a future release may keep it somewhere else or in another
 * shape. When it does, the settings screen goes back to a plain text field for the model.
 */
async function readClaudeModelCache(options: CatalogOptions): Promise<string | undefined> {
	const configDir =
		options.claudeConfigDir ??
		(options.env ?? process.env)["CLAUDE_CONFIG_DIR"] ??
		path.join(os.homedir(), ".claude");
	const cacheDir = path.join(configDir, "cache", "model-catalog");

	try {
		// `published-floor.json` indexes the catalogs beside it and says when each was recorded, so
		// the freshest one can be picked without guessing at the hash in its name.
		const floor = JSON.parse(
			await readFile(path.join(cacheDir, "published-floor.json"), "utf8"),
		) as {
			sources?: Record<string, { recordedAt?: number }>;
		};
		const newest = Object.entries(floor.sources ?? {}).toSorted(
			([, a], [, b]) => (b.recordedAt ?? 0) - (a.recordedAt ?? 0),
		)[0]?.[0];

		if (newest !== undefined) {
			return await readFile(path.join(cacheDir, `published-${newest}.json`), "utf8");
		}
	} catch {
		// No index, or an index that says nothing useful; fall through and look for a file directly.
	}

	try {
		const named = (await readdir(cacheDir))
			.filter((file) => file.startsWith("published-") && file !== "published-floor.json")
			.toSorted();
		const last = named.at(-1);
		return last === undefined ? undefined : await readFile(path.join(cacheDir, last), "utf8");
	} catch {
		return undefined;
	}
}

function ask(
	agent: AgentKind,
	args: string[],
	options: CatalogOptions,
): Promise<{ stdout: string }> {
	return run(options.agentPaths?.[agent] ?? AGENT_EXECUTABLES[agent], args, {
		env: options.env ?? process.env,
		timeout: options.timeoutMs ?? 15_000,
		maxBuffer: 32 * 1024 * 1024,
	});
}
