import { expect, test } from "vitest";
import { version } from "./index.js";

test("core package exports a version", () => {
	expect(version).toBe("0.0.0");
});
