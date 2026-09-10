import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { claudeCatalog, claudeDialect, parseClaudeEfforts, parseClaudeModels } from "./claude.js";
import { effortsFor } from "./catalog.js";
import type { AgentProgress } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** A trimmed copy of the catalog Claude Code caches for its own model picker. */
const CATALOG = readFileSync(path.join(here, "__fixtures__", "claude-model-catalog.json"), "utf8");
const VERSION = "2.1.267 (Claude Code)";

/** As Claude Code's own `--help` renders it, wrapped across lines and all. */
const HELP = `Options:
  --effort <level>                      Effort level for the current session
                                        (low, medium, high, xhigh, max)
  --model <model>                       Model for the current session.
`;

function read(lines: string[]): (AgentProgress | undefined)[] {
	const reader = claudeDialect.reader();
	return lines.map((line) => reader(line));
}

describe("parseClaudeEfforts", () => {
	it("reads the levels out of the installed CLI's own help", () => {
		expect(parseClaudeEfforts(HELP).map((level) => level.effort)).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
	});

	it("says nothing rather than guessing when the help has changed shape", () => {
		expect(parseClaudeEfforts("Options:\n  --model <model>  A model.\n")).toEqual([]);
	});
});

describe("claudeCatalog", () => {
	it("offers the models the cached catalog names", () => {
		const catalog = claudeCatalog({ help: HELP, version: VERSION, catalog: CATALOG });

		expect(catalog.agent).toBe("claude");
		expect(catalog.openModels).toBe(false);
		expect(catalog.models.map((model) => model.slug)).toContain("claude-sonnet-5");
		expect(catalog.efforts).toHaveLength(5);
	});

	it("falls back to a free-text model when there is no catalog to read", () => {
		const catalog = claudeCatalog({ help: HELP });

		expect(catalog.openModels).toBe(true);
		expect(catalog.models).toEqual([]);
		// The levels still come from the help, which is the supported interface of the two.
		expect(catalog.efforts).toHaveLength(5);
	});

	it("says nothing rather than guessing when the cache is not what it expects", () => {
		expect(claudeCatalog({ help: HELP, catalog: "{}" }).models).toEqual([]);
		expect(claudeCatalog({ help: HELP, catalog: "not json" }).models).toEqual([]);
	});
});

describe("parseClaudeModels", () => {
	const models = parseClaudeModels(CATALOG, VERSION);
	const bySlug = (slug: string) => models.find((model) => model.slug === slug);

	it("names each model the way Claude Code's own picker does", () => {
		expect(bySlug("claude-sonnet-5")).toMatchObject({
			displayName: "Sonnet 5",
			listed: true,
		});
	});

	it("offers aliases first, because they track the model rather than pinning it", () => {
		expect(models[0]?.slug).toBe("fable");
		expect(bySlug("sonnet")).toMatchObject({
			displayName: "Sonnet (latest)",
			description: "Currently Sonnet 5.",
		});
	});

	it("gives an alias the effort levels of whatever it points at", () => {
		expect(bySlug("sonnet")?.efforts).toEqual(bySlug("claude-sonnet-5")?.efforts);
	});

	it("keeps the effort levels of each model, which are not the same everywhere", () => {
		expect(bySlug("claude-sonnet-5")?.efforts.map((level) => level.effort)).toEqual([
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		]);
		// An older model that never gained the extra level.
		expect(bySlug("claude-opus-4-6")?.efforts.map((level) => level.effort)).not.toContain("xhigh");
	});

	it("keeps an effort name only when it says something the level itself does not", () => {
		const levels = bySlug("claude-sonnet-5")?.efforts ?? [];

		// "medium" is named "Medium", which beside the level is noise; "xhigh" is named "Extra".
		expect(levels.find((level) => level.effort === "medium")?.description).toBe("");
		expect(levels.find((level) => level.effort === "xhigh")?.description).toBe("Extra");
	});

	it("takes the default effort from the level the catalog badges as one", () => {
		expect(bySlug("claude-sonnet-5")?.defaultEffort).toBe("high");
		expect(bySlug("claude-opus-4-6")?.defaultEffort).toBe("high");
	});

	it("hides the models its own picker keeps behind the overflow list", () => {
		expect(bySlug("claude-opus-4-6")?.listed).toBe(false);
	});

	it("hides a model the installed build is too old to run", () => {
		const older = parseClaudeModels(CATALOG, "2.1.100 (Claude Code)");

		expect(older.find((model) => model.slug === "claude-fable-5-1")?.listed).toBe(false);
		expect(older.find((model) => model.slug === "claude-sonnet-5")?.listed).toBe(true);
	});

	it("offers everything when it cannot tell which build is installed", () => {
		expect(
			parseClaudeModels(CATALOG, undefined).find((model) => model.slug === "claude-fable-5-1")
				?.listed,
		).toBe(true);
	});

	it("falls back to the shared levels for a model with none of its own", () => {
		const catalog = claudeCatalog({ help: HELP, version: VERSION, catalog: CATALOG });

		expect(bySlug("claude-haiku-4-5-20251001")?.efforts).toEqual([]);
		expect(effortsFor(catalog, "claude-haiku-4-5-20251001")).toHaveLength(5);
	});

	it("copes with a catalog that has grown fields it does not know", () => {
		const grown = JSON.stringify({
			document: {
				surfaces: {
					cc: { model_selector_config: [{ models: [{ id: "future", something_new: true }] }] },
				},
			},
			extra: 1,
		});

		expect(parseClaudeModels(grown, VERSION)).toEqual([
			{
				slug: "future",
				displayName: "future",
				description: "",
				defaultEffort: "medium",
				efforts: [],
				listed: false,
			},
		]);
	});

	it("skips a model with no id rather than inventing one", () => {
		const nameless = JSON.stringify({
			document: {
				surfaces: { cc: { model_selector_config: [{ models: [{ name: "Nameless" }] }] } },
			},
		});

		expect(parseClaudeModels(nameless, VERSION)).toEqual([]);
	});
});

describe("the Claude message reader", () => {
	it("takes the session id and the model from the init message", () => {
		expect(
			read([
				JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "opus-5" }),
			])[0],
		).toEqual({ kind: "session", sessionId: "s1", model: "opus-5" });
	});

	it("pairs a tool result back to the command that asked for it", () => {
		const progress = read([
			JSON.stringify({
				type: "assistant",
				message: {
					content: [{ type: "tool_use", id: "c1", name: "Bash", input: { command: "git log" } }],
				},
			}),
			JSON.stringify({
				type: "user",
				message: { content: [{ type: "tool_result", tool_use_id: "c1", is_error: true }] },
			}),
		]);

		expect(progress[0]).toEqual({ kind: "command", command: "git log", status: "started" });
		expect(progress[1]).toEqual({
			kind: "command",
			command: "git log",
			status: "finished",
			exitCode: 1,
		});
	});

	it("reads the result's own tokens, counting cache writes as input and reads apart", () => {
		expect(
			read([
				JSON.stringify({
					type: "result",
					is_error: false,
					result: "done",
					usage: {
						input_tokens: 8,
						cache_creation_input_tokens: 2,
						cache_read_input_tokens: 4,
						output_tokens: 3,
					},
				}),
			])[0],
		).toMatchObject({
			kind: "result",
			text: "done",
			error: null,
			usage: {
				inputTokens: 10,
				cachedInputTokens: 4,
				outputTokens: 3,
				reasoningOutputTokens: 0,
			},
		});
	});

	it("carries a failure it reports in-band", () => {
		expect(
			read([JSON.stringify({ type: "result", is_error: true, result: "Not logged in" })])[0],
		).toMatchObject({ kind: "result", error: "Not logged in" });
	});

	it("ignores messages it does not understand", () => {
		expect(read(['{"type":"something_new"}', "not json at all", ""])).toEqual([
			undefined,
			undefined,
			undefined,
		]);
	});
});
