import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const MARKER = "__proctologist_path__";

/** Extra places to look, for the case where the login shell cannot be read at all. */
const FALLBACKS = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"];

export interface LoginShellPathOptions {
	shell?: string | undefined;
	env?: NodeJS.ProcessEnv;
	timeoutMs?: number;
}

/**
 * Reads `PATH` as the user's login shell sees it.
 *
 * An app launched from Finder inherits a bare `PATH` that holds none of the places a package
 * manager installs to, so `gh`, `codex` and often `git` are simply not found. The shell is asked as
 * a login *and* interactive shell because people set their path in `.zprofile` and `.zshrc` about
 * equally often.
 */
export async function readLoginShellPath(
	options: LoginShellPathOptions = {},
): Promise<string | undefined> {
	const env = options.env ?? process.env;
	const shell = options.shell ?? env["SHELL"];
	if (!shell) {
		return undefined;
	}

	try {
		const { stdout } = await run(shell, ["-ilc", `printf '${MARKER}%s${MARKER}' "$PATH"`], {
			// Startup files print banners and run update checks; the marker isolates the answer.
			env: { ...env, DISABLE_AUTO_UPDATE: "true" },
			timeout: options.timeoutMs ?? 5000,
		});
		const match = new RegExp(`${MARKER}(.*)${MARKER}`, "s").exec(stdout);
		const value = match?.[1]?.trim();
		return value === undefined || value === "" ? undefined : value;
	} catch {
		return undefined;
	}
}

/** Merges `addition` into `current`, keeping the order and dropping anything already there. */
export function mergePath(current: string | undefined, addition: string | undefined): string {
	const seen = new Set<string>();
	const entries: string[] = [];

	for (const part of [...split(addition), ...split(current), ...FALLBACKS]) {
		if (!seen.has(part)) {
			seen.add(part);
			entries.push(part);
		}
	}

	return entries.join(":");
}

function split(value: string | undefined): string[] {
	return (value ?? "")
		.split(":")
		.map((part) => part.trim())
		.filter((part) => part !== "");
}

/**
 * Puts the login shell's `PATH` in front of this process's own, so the child processes the app
 * spawns find the same tools the user's terminal does.
 */
export async function inheritLoginShellPath(options: LoginShellPathOptions = {}): Promise<string> {
	const env = options.env ?? process.env;
	const merged = mergePath(env["PATH"], await readLoginShellPath(options));
	env["PATH"] = merged;
	return merged;
}
