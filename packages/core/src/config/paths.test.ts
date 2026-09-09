import { describe, expect, it } from "vitest";
import { expandHome, repositoryCacheDir, resolvePaths, resolveUserPath } from "./paths.js";

const home = "/Users/example";

describe("resolvePaths", () => {
	it("puts config under ~/.config/proctologist by default", () => {
		const paths = resolvePaths({ homeDir: home, env: {}, platform: "darwin" });

		expect(paths.configDir).toBe("/Users/example/.config/proctologist");
		expect(paths.configFile).toBe("/Users/example/.config/proctologist/config.toml");
	});

	it("honours an absolute XDG_CONFIG_HOME", () => {
		const paths = resolvePaths({
			homeDir: home,
			env: { XDG_CONFIG_HOME: "/tmp/xdg" },
			platform: "darwin",
		});

		expect(paths.configFile).toBe("/tmp/xdg/proctologist/config.toml");
	});

	it("ignores a relative XDG_CONFIG_HOME", () => {
		const paths = resolvePaths({
			homeDir: home,
			env: { XDG_CONFIG_HOME: "relative/dir" },
			platform: "darwin",
		});

		expect(paths.configDir).toBe("/Users/example/.config/proctologist");
	});

	it("uses macOS library folders for data and cache", () => {
		const paths = resolvePaths({ homeDir: home, env: {}, platform: "darwin" });

		expect(paths.dataDir).toBe("/Users/example/Library/Application Support/PRoctologist");
		expect(paths.databaseFile).toBe(
			"/Users/example/Library/Application Support/PRoctologist/data.sqlite",
		);
		expect(paths.cacheDir).toBe("/Users/example/Library/Caches/PRoctologist");
	});

	it("falls back to XDG data and cache folders off macOS", () => {
		const paths = resolvePaths({ homeDir: home, env: {}, platform: "linux" });

		expect(paths.dataDir).toBe("/Users/example/.local/share/proctologist");
		expect(paths.cacheDir).toBe("/Users/example/.cache/proctologist");
	});

	it("lets data_dir override the database location", () => {
		const paths = resolvePaths({
			homeDir: home,
			env: {},
			platform: "darwin",
			dataDir: "~/somewhere/else",
		});

		expect(paths.dataDir).toBe("/Users/example/somewhere/else");
		expect(paths.databaseFile).toBe("/Users/example/somewhere/else/data.sqlite");
		expect(paths.cacheDir).toBe("/Users/example/Library/Caches/PRoctologist");
	});

	it("resolves a relative data_dir against the home folder", () => {
		const paths = resolvePaths({
			homeDir: home,
			env: {},
			platform: "darwin",
			dataDir: "elsewhere",
		});

		expect(paths.dataDir).toBe("/Users/example/elsewhere");
	});
});

describe("repositoryCacheDir", () => {
	it("nests owner and name under the cache folder", () => {
		const paths = resolvePaths({ homeDir: home, env: {}, platform: "darwin" });

		expect(repositoryCacheDir(paths, "owner/name")).toBe(
			"/Users/example/Library/Caches/PRoctologist/owner/name",
		);
	});

	it("rejects a name that is not owner/name", () => {
		const paths = resolvePaths({ homeDir: home, env: {}, platform: "darwin" });

		expect(() => repositoryCacheDir(paths, "../escape")).toThrow(/owner\/name/);
	});
});

describe("expandHome", () => {
	it("expands a leading tilde, which the shell would have done for us", () => {
		expect(expandHome("~/Projects/thing", home)).toBe("/Users/example/Projects/thing");
		expect(expandHome("~", home)).toBe(home);
	});

	it("leaves everything else exactly as written", () => {
		expect(expandHome("/Projects/thing", home)).toBe("/Projects/thing");
		expect(expandHome("Projects/thing", home)).toBe("Projects/thing");
		expect(expandHome("~thing", home)).toBe("~thing");
		expect(expandHome("./~/thing", home)).toBe("./~/thing");
	});
});

describe("resolveUserPath", () => {
	it("expands a tilde and resolves anything still relative against the home folder", () => {
		expect(resolveUserPath("~/pr", home)).toBe("/Users/example/pr");
		expect(resolveUserPath("pr", home)).toBe("/Users/example/pr");
		expect(resolveUserPath("/pr", home)).toBe("/pr");
	});
});
