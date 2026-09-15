import {
	PROFILE_FALLBACKS,
	sameProfile,
	type Config,
	type ProfileName,
} from "@proctologist/core/browser";

/**
 * Patches one profile, and carries every profile inheriting from it along. A profile inherits by
 * being equal to its parent — that is how the dialog tells "Same as quick assessment" from an
 * override — so one left behind when its parent moves would stop being equal, show as set
 * separately, and be written to the file as an override the user never made. One that already
 * differs is an override and keeps its own values.
 */
export function withProfile(
	config: Config,
	name: ProfileName,
	patch: Partial<Config["profiles"][ProfileName]>,
): Config {
	const before = config.profiles[name];
	const after = { ...before, ...patch };
	const profiles = { ...config.profiles, [name]: after };
	for (const [child, parent] of Object.entries(PROFILE_FALLBACKS)) {
		if (parent === name && sameProfile(config.profiles[child as ProfileName], before)) {
			profiles[child as ProfileName] = { ...after };
		}
	}
	return { ...config, profiles };
}
