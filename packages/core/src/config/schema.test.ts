import { describe, expect, it } from "vitest";
import {
	ConfigError,
	defaultConfig,
	parseConfig,
	resolveCodexProfile,
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

	it("reads codex profiles and keeps the defaults for keys left out", () => {
		const config = parseConfig(`
			[codex.profiles.assess]
			model = "some-model"
		`);

		expect(config.codexProfiles.assess).toEqual({
			model: "some-model",
			reasoningEffort: defaultConfig.codexProfiles.assess.reasoningEffort,
			timeoutMinutes: defaultConfig.codexProfiles.assess.timeoutMinutes,
		});
		expect(config.codexProfiles.review).toEqual(defaultConfig.codexProfiles.review);
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
			codexProfiles: {},
		});
		expect(config.repositories[1]?.codexProfiles).toEqual({});
	});

	it("reads per-repository codex overrides", () => {
		const config = parseConfig(`
			[[repositories]]
			name = "owner/thing"

			[repositories.codex.profiles.thorough]
			model = "override-model"
			timeout_minutes = 45
		`);

		expect(config.repositories[0]?.codexProfiles.thorough).toEqual({
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
					[codex.profiles.assess]
					reasoning_effort = "Very High!"
				`),
			).toThrow(/codex\.profiles\.assess\.reasoning_effort/);
		});

		it("accepts a reasoning level it has never heard of, because Codex decides", () => {
			const config = parseConfig(`
				[codex.profiles.thorough]
				reasoning_effort = "ultra"
			`);

			expect(config.codexProfiles.thorough.reasoningEffort).toBe("ultra");
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

			[codex.profiles.review]
			model = "strong"

			[[repositories]]
			name = "owner/thing"
			clone = "~/code/thing"

			[repositories.codex.profiles.assess]
			timeout_minutes = 9
		`);

		expect(parseConfig(serializeConfig(config))).toEqual(config);
	});

	it("omits keys that were never set", () => {
		expect(serializeConfig(defaultConfig)).not.toMatch(/data_dir/);
	});
});

describe("resolveCodexProfile", () => {
	const config = parseConfig(`
		[codex.profiles.assess]
		model = "base-model"

		[[repositories]]
		name = "owner/thing"

		[repositories.codex.profiles.assess]
		timeout_minutes = 9

		[[repositories]]
		name = "other/repo"
	`);

	it("merges the repository override over the base profile", () => {
		expect(resolveCodexProfile(config, "owner/thing", "assess")).toEqual({
			model: "base-model",
			reasoningEffort: defaultConfig.codexProfiles.assess.reasoningEffort,
			timeoutMinutes: 9,
		});
	});

	it("returns the base profile for a repository without overrides", () => {
		expect(resolveCodexProfile(config, "other/repo", "assess")).toEqual(
			config.codexProfiles.assess,
		);
	});

	it("returns the base profile for an untracked repository", () => {
		expect(resolveCodexProfile(config, "nobody/nothing", "review")).toEqual(
			config.codexProfiles.review,
		);
	});
});
