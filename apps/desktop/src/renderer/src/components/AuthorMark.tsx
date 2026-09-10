import { RobotIcon, UserIcon, WrenchIcon, type Icon } from "@phosphor-icons/react";
import { isMaintainerAssociation, type StoredPullRequest } from "@proctologist/core/browser";
import { Glyph, type GlyphTone } from "./Glyph.js";

interface Mark {
	icon: Icon;
	label: string;
	tone?: GlyphTone;
}

/**
 * What kind of author this is, as one glyph before the login. The kinds are ranked: the user's own
 * pull request says so even though the user is a maintainer, and a bot is a bot whatever GitHub
 * calls its association.
 */
export function authorMarkFor(pullRequest: StoredPullRequest): Mark | undefined {
	if (pullRequest.authoredByUser) {
		return { icon: UserIcon, label: "You opened this", tone: "accent" };
	}
	if (pullRequest.isBot) {
		return { icon: RobotIcon, label: "Opened by a bot", tone: "accent" };
	}
	if (isMaintainerAssociation(pullRequest.authorAssociation)) {
		return { icon: WrenchIcon, label: "Opened by a maintainer" };
	}
	return undefined;
}

export function AuthorMark({
	pullRequest,
}: {
	pullRequest: StoredPullRequest;
}): React.JSX.Element | null {
	const mark = authorMarkFor(pullRequest);
	if (!mark) {
		return null;
	}
	return <Glyph icon={mark.icon} label={mark.label} shape="chip" tone={mark.tone} />;
}
