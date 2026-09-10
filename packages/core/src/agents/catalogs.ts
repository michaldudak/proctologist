import { execFile } from "node:child_process";
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
}

/** What each agent is asked to describe itself with, and how to read the answer. */
const QUESTIONS: Record<AgentKind, { args: string[]; parse: (stdout: string) => AgentCatalog }> = {
	codex: { args: ["debug", "models"], parse: parseCodexCatalog },
	claude: { args: ["--help"], parse: claudeCatalog },
};

/**
 * Asks one installed agent which models and effort levels it accepts. A missing or unhappy agent
 * is not an error: the catalog comes back empty with a reason, and the settings screen falls back
 * to free text rather than refusing to open.
 */
export async function readAgentCatalog(
	agent: AgentKind,
	options: CatalogOptions = {},
): Promise<AgentCatalog> {
	const question = QUESTIONS[agent];
	try {
		const { stdout } = await run(
			options.agentPaths?.[agent] ?? AGENT_EXECUTABLES[agent],
			question.args,
			{
				env: options.env ?? process.env,
				timeout: options.timeoutMs ?? 15_000,
				maxBuffer: 32 * 1024 * 1024,
			},
		);
		return question.parse(stdout);
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
