import { describe, expect, it } from "vitest";
import {
	adoptConfig,
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
			schedule = { enabled = false, interval_minutes = 30 }
		`);

		expect(config.concurrency).toBe(2);
		expect(config.outdatedAfterDays).toBe(7);
		expect(config.closedRetentionDays).toBe(0);
		expect(config.diffCutoffKb).toBe(120);
		expect(config.dataDir).toBe("~/pr");
		expect(config.schedule).toEqual({ enabled: false, intervalMinutes: 30 });
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
			thorough_instructions = "Run the test suite."
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
			thoroughInstructions: "Run the test suite.",
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

		it("leaves the effort out when the file does not name one, so the agent decides", () => {
			const config = parseConfig(`
			[profiles.assess]
			agent = "claude"
		`);
			expect(config.profiles.assess.effort).toBeUndefined();
			expect(serializeConfig(config)).not.toContain("effort");
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

		it("rejects a schedule interval under five minutes", () => {
			expect(() => parseConfig(`schedule = { interval_minutes = 1 }`)).toThrow(
				/schedule\.interval_minutes/,
			);
		});

		it("ignores the time of day the schedule used to have", () => {
			expect(parseConfig(`schedule = { enabled = true, time = "08:00" }`).schedule).toEqual({
				enabled: true,
				intervalMinutes: 60,
			});
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

describe("adoptConfig", () => {
	it("reads a file this build understands exactly as parseConfig does", () => {
		const text = `
			concurrency = 3

			[[repositories]]
			name = "owner/name"
			clone = "/tmp/clone"
		`;

		expect(adoptConfig(text)).toEqual({ config: parseConfig(text), ignored: [] });
	});

	it("leaves out a key this build has never heard of and keeps the rest", () => {
		const { config, ignored } = adoptConfig(`
			concurrency = 3
			telemetry_endpoint = "https://example.test"
		`);

		expect(config.concurrency).toBe(3);
		expect(ignored).toEqual(["telemetry_endpoint"]);
	});

	it("leaves out an unknown key inside a repository without losing the repository", () => {
		const { config, ignored } = adoptConfig(`
			[[repositories]]
			name = "owner/name"
			clone = "/tmp/clone"
			issue_instructions = "judge the issues too"
		`);

		expect(config.repositories.map((entry) => entry.name)).toEqual(["owner/name"]);
		expect(config.repositories[0]?.clone).toBe("/tmp/clone");
		expect(ignored).toEqual(["repositories.0.issue_instructions"]);
	});

	it("leaves out an unknown key inside a profile without losing the profile", () => {
		const { config, ignored } = adoptConfig(`
			[profiles.review]
			agent = "claude"
			sandbox = "danger-full-access"
		`);

		expect(config.profiles.review.agent).toBe("claude");
		expect(ignored).toEqual(["profiles.review.sandbox"]);
	});

	it("falls back to the default for a key that now holds something else", () => {
		const { config, ignored } = adoptConfig(`
			concurrency = "as many as it takes"
			diff_cutoff_kb = 120
		`);

		expect(config.concurrency).toBe(defaultConfig.concurrency);
		expect(config.diffCutoffKb).toBe(120);
		expect(ignored).toEqual(["concurrency"]);
	});

	// A repository read halfway is worse than one left out: it would be tracked under a name the
	// build invented, or fetched from a clone it never checked.
	it("leaves out a repository it cannot read and keeps the others", () => {
		const { config, ignored } = adoptConfig(`
			[[repositories]]
			name = "not a repository"
			clone = "/tmp/one"

			[[repositories]]
			name = "owner/name"
			clone = "/tmp/two"
		`);

		expect(config.repositories.map((entry) => entry.name)).toEqual(["owner/name"]);
		expect(ignored).toEqual(["repositories.0"]);
	});

	it("says a repository was left out once, not once for every part of it", () => {
		const { config, ignored } = adoptConfig(`
			[[repositories]]
			name = "not a repository"
			issue_instructions = "judge the issues too"

			[[repositories]]
			name = "owner/name"
		`);

		expect(config.repositories.map((entry) => entry.name)).toEqual(["owner/name"]);
		expect(ignored).toEqual(["repositories.0"]);
	});

	it("leaves out a repository the file tracks twice", () => {
		const { config, ignored } = adoptConfig(`
			[[repositories]]
			name = "owner/name"
			clone = "/tmp/one"

			[[repositories]]
			name = "owner/name"
			clone = "/tmp/two"
		`);

		expect(config.repositories.map((entry) => entry.clone)).toEqual(["/tmp/one"]);
		expect(ignored).toEqual(["repositories.1"]);
	});

	it("still refuses a file that is not TOML at all", () => {
		expect(() => adoptConfig("this is not = = toml", "/tmp/config.toml")).toThrow(ConfigError);
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
