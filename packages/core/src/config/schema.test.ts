import { describe, expect, it } from "vitest";
import {
	ConfigError,
	defaultConfig,
	parseConfig,
	resolveProfile,
	serializeConfig,
} from "./schema.js";

describe("parseConfig", () => {
	it("returns the defaults for an empty file", () => {
		expect(parseConfig("")).toEqual(defaultConfig);
	});

	it("keeps no repositories by default", () => {
		expect(defaultConfig.repositories).toEqual([]);
	});

	it("reads the top-level settings", () => {
		const config = parseConfig(`
			concurrency = 2
			outdated_after_days = 7
			closed_retention_days = 0
			diff_cutoff_kb = 120
			data_dir = "~/pr"
			schedule = { enabled = true, time = "07:30" }
		`);

		expect(config.concurrency).toBe(2);
		expect(config.outdatedAfterDays).toBe(7);
		expect(config.closedRetentionDays).toBe(0);
		expect(config.diffCutoffKb).toBe(120);
		expect(config.dataDir).toBe("~/pr");
		expect(config.schedule).toEqual({ enabled: true, time: "07:30" });
	});

	it("reads profiles and keeps the defaults for keys left out", () => {
		const config = parseConfig(`
			[profiles.assess]
			agent = "claude"
			model = "some-model"
		`);

		expect(config.profiles.assess).toEqual({
			agent: "claude",
			model: "some-model",
			effort: defaultConfig.profiles.assess.effort,
			timeoutMinutes: defaultConfig.profiles.assess.timeoutMinutes,
		});
		expect(config.profiles.review).toEqual(defaultConfig.profiles.review);
	});

	it("lets each profile name its own agent, so one job can go to Codex and another to Claude", () => {
		const config = parseConfig(`
			[profiles.assess]
			agent = "codex"

			[profiles.review]
			agent = "claude"
			model = "opus"
		`);

		expect(config.profiles.assess.agent).toBe("codex");
		expect(config.profiles.review).toMatchObject({ agent: "claude", model: "opus" });
	});

	it("reads the shape the file had when Codex was the only agent", () => {
		const config = parseConfig(`
			[codex.profiles.assess]
			model = "some-model"
			reasoning_effort = "high"

			[[repositories]]
			name = "owner/thing"

			[repositories.codex.profiles.review]
			timeout_minutes = 45
		`);

		expect(config.profiles.assess).toMatchObject({
			agent: "codex",
			model: "some-model",
			effort: "high",
		});
		expect(config.repositories[0]?.profiles.review).toEqual({ timeoutMinutes: 45 });
	});

	it("reads tracked repositories and splits the owner from the name", () => {
		const config = parseConfig(`
			[[repositories]]
			name = "owner/thing"
			clone = "~/code/thing"
			context = "Some context."
			review_instructions = "Use the house review skill."

			[[repositories]]
			name = "other/repo"
		`);

		expect(config.repositories).toHaveLength(2);
		expect(config.repositories[0]).toEqual({
			name: "owner/thing",
			owner: "owner",
			repo: "thing",
			clone: "~/code/thing",
			context: "Some context.",
			reviewInstructions: "Use the house review skill.",
			profiles: {},
		});
		expect(config.repositories[1]?.profiles).toEqual({});
	});

	it("reads per-repository overrides", () => {
		const config = parseConfig(`
			[[repositories]]
			name = "owner/thing"

			[repositories.profiles.thorough]
			agent = "claude"
			model = "override-model"
			timeout_minutes = 45
		`);

		expect(config.repositories[0]?.profiles.thorough).toEqual({
			agent: "claude",
			model: "override-model",
			timeoutMinutes: 45,
		});
	});

	describe("errors", () => {
		it("reports invalid TOML with the file name", () => {
			expect(() => parseConfig("concurrency = ", "/tmp/config.toml")).toThrow(ConfigError);
			expect(() => parseConfig("concurrency = ", "/tmp/config.toml")).toThrow(/config\.toml/);
		});

		it("names the offending key", () => {
			expect(() => parseConfig("concurrency = 0")).toThrow(/concurrency/);
		});

		it("names a nested key", () => {
			expect(() =>
				parseConfig(`
					[profiles.assess]
					effort = "Very High!"
				`),
			).toThrow(/profiles\.assess\.effort/);
		});

		it("accepts an effort level it has never heard of, because the agent decides", () => {
			const config = parseConfig(`
				[profiles.thorough]
				effort = "ultra"
			`);

			expect(config.profiles.thorough.effort).toBe("ultra");
		});

		it("rejects an agent it has no way to run", () => {
			expect(() =>
				parseConfig(`
					[profiles.assess]
					agent = "gemini"
				`),
			).toThrow(/profiles\.assess\.agent/);
		});

		it("rejects unknown keys so typos do not pass silently", () => {
			expect(() => parseConfig("concurency = 4")).toThrow(/concurency/);
		});

		it("rejects a repository name that is not owner/name", () => {
			expect(() =>
				parseConfig(`
					[[repositories]]
					name = "thing"
				`),
			).toThrow(/repositories\.0\.name/);
		});

		it("rejects duplicate repositories", () => {
			expect(() =>
				parseConfig(`
					[[repositories]]
					name = "owner/thing"

					[[repositories]]
					name = "owner/thing"
				`),
			).toThrow(/owner\/thing/);
		});

		it("rejects a schedule time that is not HH:MM", () => {
			expect(() => parseConfig(`schedule = { time = "8am" }`)).toThrow(/schedule\.time/);
		});

		it("collects every problem into one error", () => {
			const error = (() => {
				try {
					parseConfig("concurrency = 0\ndiff_cutoff_kb = -1\n");
					return undefined;
				} catch (cause) {
					return cause as ConfigError;
				}
			})();

			expect(error?.issues).toHaveLength(2);
		});
	});
});

describe("serializeConfig", () => {
	it("round-trips a config through TOML", () => {
		const config = parseConfig(`
			concurrency = 3
			data_dir = "~/pr"

			[profiles.review]
			agent = "claude"
			model = "strong"

			[[repositories]]
			name = "owner/thing"
			clone = "~/code/thing"

			[repositories.profiles.assess]
			timeout_minutes = 9
		`);

		expect(parseConfig(serializeConfig(config))).toEqual(config);
	});

	it("omits keys that were never set", () => {
		expect(serializeConfig(defaultConfig)).not.toMatch(/data_dir/);
	});
});

describe("resolveProfile", () => {
	const config = parseConfig(`
		[profiles.assess]
		model = "base-model"

		[[repositories]]
		name = "owner/thing"

		[repositories.profiles.assess]
		timeout_minutes = 9

		[[repositories]]
		name = "other/repo"
	`);

	it("merges the repository override over the base profile", () => {
		expect(resolveProfile(config, "owner/thing", "assess")).toEqual({
			agent: defaultConfig.profiles.assess.agent,
			model: "base-model",
			effort: defaultConfig.profiles.assess.effort,
			timeoutMinutes: 9,
		});
	});

	it("returns the base profile for a repository without overrides", () => {
		expect(resolveProfile(config, "other/repo", "assess")).toEqual(config.profiles.assess);
	});

	it("returns the base profile for an untracked repository", () => {
		expect(resolveProfile(config, "nobody/nothing", "review")).toEqual(config.profiles.review);
	});
});
