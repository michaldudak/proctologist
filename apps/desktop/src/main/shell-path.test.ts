import { describe, expect, it } from "vitest";
import { inheritLoginShellPath, mergePath, readLoginShellPath } from "./shell-path.js";

describe("mergePath", () => {
	it("puts the login shell's entries first and keeps the rest", () => {
		expect(mergePath("/usr/bin:/bin", "/opt/homebrew/bin:/usr/bin")).toBe(
			"/opt/homebrew/bin:/usr/bin:/bin:/usr/local/bin:/opt/local/bin",
		);
	});

	it("drops duplicates and blanks", () => {
		expect(mergePath("/usr/bin::/usr/bin", "/usr/bin")).toBe(
			"/usr/bin:/opt/homebrew/bin:/usr/local/bin:/opt/local/bin",
		);
	});

	it("still offers the usual install locations when there is nothing to merge", () => {
		expect(mergePath(undefined, undefined)).toBe("/opt/homebrew/bin:/usr/local/bin:/opt/local/bin");
	});
});

describe("readLoginShellPath", () => {
	it("reads PATH from the shell it is given", async () => {
		const value = await readLoginShellPath({
			shell: "/bin/sh",
			env: { ...process.env, PATH: "/usr/bin:/bin" },
		});

		expect(value).toContain("/usr/bin");
	});

	it("gives up quietly when there is no shell to ask", async () => {
		expect(await readLoginShellPath({ env: { SHELL: undefined } })).toBeUndefined();
	});

	it("gives up quietly when the shell cannot be run", async () => {
		expect(await readLoginShellPath({ shell: "/nonexistent/shell" })).toBeUndefined();
	});
});

describe("inheritLoginShellPath", () => {
	it("leaves the environment holding the merged path", async () => {
		const env: NodeJS.ProcessEnv = { PATH: "/usr/bin", SHELL: "/bin/sh" };

		const merged = await inheritLoginShellPath({ env, shell: "/bin/sh" });

		expect(env["PATH"]).toBe(merged);
		expect(merged).toContain("/usr/bin");
		expect(merged).toContain("/opt/homebrew/bin");
	});
});
