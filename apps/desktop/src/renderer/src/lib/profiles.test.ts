import { describe, expect, it } from "vitest";
import { parseConfig, serializeConfig } from "@proctologist/core/browser";
import { withProfile } from "./profiles.js";

describe("withProfile", () => {
	const inheriting = parseConfig(`
		[profiles.assess]
		agent = "claude"
		model = "opus"
	`);

	it("carries a profile that inherits along when its parent changes", () => {
		const next = withProfile(inheriting, "assess", { effort: "high" });

		expect(next.profiles.triage).toEqual(next.profiles.assess);
		expect(next.profiles.triage.effort).toBe("high");
	});

	it("leaves an override alone, since differing is what makes it one", () => {
		const overridden = parseConfig(`
		[profiles.assess]
		agent = "claude"
		[profiles.triage]
		agent = "codex"
	`);

		const next = withProfile(overridden, "assess", { effort: "high" });

		expect(next.profiles.triage.agent).toBe("codex");
		expect(next.profiles.triage.effort).toBeUndefined();
	});

	it("does not turn inheritance into an override on the way to the file", () => {
		// Left behind, the triage profile would no longer equal its parent and be written out
		// as a section the user never made; read back, it would then stop following the parent.
		const text = serializeConfig(withProfile(inheriting, "assess", { model: "sonnet" }));

		expect(text).not.toContain("[profiles.triage]");
		expect(parseConfig(text).profiles.triage.model).toBe("sonnet");
	});
});
