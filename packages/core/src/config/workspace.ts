import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePaths, type AppPaths, type ResolvePathsOptions } from "./paths.js";
import { adoptConfig, ConfigError, serializeConfig } from "./schema.js";

/** Specific enough that a sweep can tell a workspace from anything else in the temporary folder. */
const WORKSPACE_PREFIX = "proctologist-workspace-";

export interface EphemeralWorkspace {
	/** The folder holding the config, the database and the cache, and nothing else. */
	dir: string;
	paths: AppPaths;
	/** Parts of the copied config this build could not read; see `adoptConfig`. */
	ignored: string[];
	/** Why nothing could be copied, when the config file exists but could not be read at all. */
	problem: string | null;
	/** Deletes the workspace. Safe to call twice, and safe when it is already gone. */
	remove: () => void;
}

export interface CreateEphemeralWorkspaceOptions extends ResolvePathsOptions {
	/** The config file to copy in. Defaults to the one this machine would normally be run with. */
	seedFrom?: string | undefined;
	/** Where to make the workspace folder. Defaults to the system's folder for temporary files. */
	parentDir?: string | undefined;
}

/**
 * Makes a throwaway workspace: a config copied from the real one, an empty database and an empty
 * cache, under a folder of their own, so a build under test can be run without its migrations,
 * its settings writes or its refreshes reaching anything the user depends on.
 *
 * Synchronous because Electron has to know where its own files go before it does anything else.
 */
export function createEphemeralWorkspace(
	options: CreateEphemeralWorkspaceOptions = {},
): EphemeralWorkspace {
	const parentDir = options.parentDir ?? os.tmpdir();
	sweepHusks(parentDir);
	const dir = mkdtempSync(path.join(parentDir, WORKSPACE_PREFIX));
	const paths = resolvePaths({ ...options, workspaceDir: dir });

	for (const folder of [paths.configDir, paths.dataDir, paths.cacheDir]) {
		mkdirSync(folder, { recursive: true });
	}

	const seeded = seedConfig(options.seedFrom ?? resolvePaths(options).configFile, paths.configFile);

	return {
		dir,
		paths,
		...seeded,
		remove: () => rmSync(dir, { recursive: true, force: true }),
	};
}

/**
 * Writes the user's tracked repositories and profiles into the workspace, so a build under test
 * has something to work on without being set up by hand every time. It is written back out rather
 * than copied byte for byte: that leaves behind anything this build cannot read, and `data_dir`
 * with it, which would otherwise send the database straight back to the real one. Comments do not
 * survive, which costs a copy that is deleted within the hour nothing.
 */
function seedConfig(
	seedFrom: string,
	configFile: string,
): Pick<EphemeralWorkspace, "ignored" | "problem"> {
	let text: string;
	try {
		text = readFileSync(seedFrom, "utf8");
	} catch {
		// Nothing to copy is the ordinary case on a machine that has never run the app.
		return { ignored: [], problem: null };
	}

	try {
		const { config, ignored } = adoptConfig(text, seedFrom);
		writeFileSync(configFile, serializeConfig({ ...config, dataDir: undefined }), "utf8");
		return { ignored, problem: null };
	} catch (cause) {
		// An unreadable config is no reason not to start: the app opens on its settings dialog with
		// nothing tracked, which is exactly where the user would fix it anyway.
		return {
			ignored: [],
			problem: cause instanceof ConfigError ? cause.message : String(cause),
		};
	}
}

/**
 * Clears out what earlier instances could not. Chromium writes its own files back into the user
 * data folder as it shuts down, which is after the app has deleted the workspace and after the
 * last hook it can run, so even an instance that quit tidily leaves a husk behind: a workspace
 * with the config, the database and the cache gone and nothing in it but Chromium's defaults.
 * Those are swept on the way into a new workspace, since nothing is in a position to sweep them on
 * the way out.
 *
 * A workspace still holding its three folders is left alone. It belongs either to an instance
 * running right now or to one that was killed outright, and there is no telling which from here;
 * the system clears its own temporary folder in time.
 */
function sweepHusks(parentDir: string): void {
	let entries;
	try {
		entries = readdirSync(parentDir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory() || !entry.name.startsWith(WORKSPACE_PREFIX)) {
			continue;
		}
		const dir = path.join(parentDir, entry.name);
		const workspace = resolvePaths({ workspaceDir: dir });
		const emptied = [workspace.configDir, workspace.dataDir, workspace.cacheDir].every(
			(folder) => !existsSync(folder),
		);
		if (emptied) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}
