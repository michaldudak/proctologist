import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolvePaths, type AppPaths, type ResolvePathsOptions } from "./paths.js";
import { ConfigError, defaultConfig, parseConfig, serializeConfig, type Config } from "./schema.js";

export interface ConfigLocationOptions extends ResolvePathsOptions {
	/** Overrides the config file location entirely, for a `--config` flag. */
	configFile?: string;
}

export interface LoadedConfig {
	config: Config;
	paths: AppPaths;
	/** False when the file is missing and the defaults are in use, which means first run. */
	exists: boolean;
}

/**
 * Reads and validates the config file, then resolves every path the app uses, honouring the
 * `data_dir` key. A missing file is not an error; it yields the defaults and `exists: false`.
 */
export async function loadConfig(options: ConfigLocationOptions = {}): Promise<LoadedConfig> {
	const configFile = options.configFile ?? resolvePaths(options).configFile;

	let text: string | undefined;
	try {
		text = await readFile(configFile, "utf8");
	} catch (cause) {
		if (!isNotFound(cause)) {
			throw new ConfigError(`Could not read the config file ${configFile}: ${String(cause)}`);
		}
	}

	const config = text === undefined ? defaultConfig : parseConfig(text, configFile);

	return {
		config,
		paths: {
			...resolvePaths({ ...options, dataDir: config.dataDir }),
			configDir: path.dirname(configFile),
			configFile,
		},
		exists: text !== undefined,
	};
}

/** Writes the config file atomically so a crash mid-write cannot leave a half-parsed file. */
export async function writeConfig(
	config: Config,
	options: ConfigLocationOptions = {},
): Promise<void> {
	const configFile = options.configFile ?? resolvePaths(options).configFile;
	await mkdir(path.dirname(configFile), { recursive: true });

	const temporary = `${configFile}.${process.pid}.tmp`;
	try {
		await writeFile(temporary, serializeConfig(config), "utf8");
		await rename(temporary, configFile);
	} catch (cause) {
		await rm(temporary, { force: true });
		throw new ConfigError(`Could not write the config file ${configFile}: ${String(cause)}`);
	}
}

export interface WatchConfigOptions extends ConfigLocationOptions {
	onChange: (loaded: LoadedConfig) => void;
	/** Called instead of `onChange` when the file on disk is unreadable or invalid. */
	onError?: (error: ConfigError) => void;
	/** Editors write in bursts; only the settled state is reported. */
	debounceMs?: number;
}

export interface ConfigWatcher {
	close: () => Promise<void>;
}

/**
 * Watches the config file for edits made outside the app. Watching the directory rather than the
 * file itself is what makes this survive editors that replace the file instead of rewriting it.
 */
export async function watchConfig(options: WatchConfigOptions): Promise<ConfigWatcher> {
	const configFile = options.configFile ?? resolvePaths(options).configFile;
	const configDir = path.dirname(configFile);
	const fileName = path.basename(configFile);
	const debounceMs = options.debounceMs ?? 150;

	await mkdir(configDir, { recursive: true });

	let timer: NodeJS.Timeout | undefined;
	let closed = false;

	const reload = async (): Promise<void> => {
		let loaded: LoadedConfig;
		try {
			loaded = await loadConfig({ ...options, configFile });
		} catch (cause) {
			if (!closed) {
				options.onError?.(cause instanceof ConfigError ? cause : new ConfigError(String(cause)));
			}
			return;
		}
		if (!closed) {
			options.onChange(loaded);
		}
	};

	const watcher: FSWatcher = watch(configDir, (_event, changed) => {
		if (changed !== null && changed !== fileName) {
			return;
		}
		clearTimeout(timer);
		timer = setTimeout(() => void reload(), debounceMs);
	});

	watcher.on("error", (cause) => {
		options.onError?.(new ConfigError(`Could not watch ${configDir}: ${String(cause)}`));
	});

	return {
		close: async () => {
			closed = true;
			clearTimeout(timer);
			watcher.close();
		},
	};
}

function isNotFound(cause: unknown): boolean {
	return (
		typeof cause === "object" &&
		cause !== null &&
		"code" in cause &&
		(cause as { code?: unknown }).code === "ENOENT"
	);
}
