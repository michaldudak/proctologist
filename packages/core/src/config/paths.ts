import path from "node:path";
import os from "node:os";

/** Directory name used wherever the platform expects a lowercase, command-line style name. */
const UNIX_NAME = "proctologist";

/** Display name used wherever the platform expects a human-readable application name. */
const MAC_NAME = "PRoctologist";

/** GitHub segment: at least one character that is not a dot, so `.` and `..` cannot slip through. */
const SEGMENT = String.raw`[A-Za-z0-9._-]*[A-Za-z0-9_-][A-Za-z0-9._-]*`;

const REPOSITORY_PATTERN = new RegExp(`^${SEGMENT}/${SEGMENT}$`);

export interface AppPaths {
	/** Directory holding the config file and any files it references. */
	configDir: string;
	configFile: string;
	/** Directory holding data worth backing up. */
	dataDir: string;
	databaseFile: string;
	/** Directory holding worktrees, bundles and Codex logs; safe to delete at any time. */
	cacheDir: string;
}

export interface ResolvePathsOptions {
	/** The `data_dir` config key, if set. `~` and relative paths resolve against the home folder. */
	dataDir?: string | undefined;
	homeDir?: string;
	env?: Record<string, string | undefined>;
	platform?: NodeJS.Platform;
}

/**
 * Works out where the config, database and cache live. Pure: everything it depends on can be
 * passed in, so tests never touch the real home folder.
 */
export function resolvePaths(options: ResolvePathsOptions = {}): AppPaths {
	const homeDir = options.homeDir ?? os.homedir();
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;

	const configDir = path.join(xdgDir(env["XDG_CONFIG_HOME"], homeDir, ".config"), UNIX_NAME);

	const defaultDataDir =
		platform === "darwin"
			? path.join(homeDir, "Library", "Application Support", MAC_NAME)
			: path.join(xdgDir(env["XDG_DATA_HOME"], homeDir, path.join(".local", "share")), UNIX_NAME);

	const cacheDir =
		platform === "darwin"
			? path.join(homeDir, "Library", "Caches", MAC_NAME)
			: path.join(xdgDir(env["XDG_CACHE_HOME"], homeDir, ".cache"), UNIX_NAME);

	const dataDir = options.dataDir ? resolveUserPath(options.dataDir, homeDir) : defaultDataDir;

	return {
		configDir,
		configFile: path.join(configDir, "config.toml"),
		dataDir,
		databaseFile: path.join(dataDir, "data.sqlite"),
		cacheDir,
	};
}

/** Cache folder for one tracked repository, named `owner/name`. */
export function repositoryCacheDir(paths: Pick<AppPaths, "cacheDir">, repository: string): string {
	if (!REPOSITORY_PATTERN.test(repository)) {
		throw new Error(`Repository must be written as owner/name, got "${repository}"`);
	}

	const [owner, name] = repository.split("/") as [string, string];
	return path.join(paths.cacheDir, owner, name);
}

/**
 * Expands a leading `~`, which is what a person writes in a config file or a text field and what
 * the shell would have expanded before any program saw it. Anything else is returned unchanged.
 */
export function expandHome(value: string, homeDir: string = os.homedir()): string {
	if (value === "~") {
		return homeDir;
	}
	return value.startsWith("~/") ? path.join(homeDir, value.slice(2)) : value;
}

/**
 * Expands `~` and resolves anything still relative against the home folder, so a config file stays
 * portable regardless of the working directory the app was started from.
 */
export function resolveUserPath(value: string, homeDir: string = os.homedir()): string {
	const expanded = expandHome(value, homeDir);
	return path.resolve(homeDir, expanded);
}

/** An XDG variable only counts when it is an absolute path, per the specification. */
function xdgDir(value: string | undefined, homeDir: string, fallback: string): string {
	return value && path.isAbsolute(value) ? value : path.join(homeDir, fallback);
}
