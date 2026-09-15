import { RobotIcon, UserIcon, WrenchIcon, type Icon } from "@phosphor-icons/react";
import { isMaintainerAssociation, type StoredItem } from "@proctologist/core/browser";
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
export function authorMarkFor(item: StoredItem): Mark | undefined {
	if (item.authoredByUser) {
		return { icon: UserIcon, label: "You opened this", tone: "accent" };
	}
	if (item.isBot) {
		return { icon: RobotIcon, label: "Opened by a bot", tone: "accent" };
	}
	if (isMaintainerAssociation(item.authorAssociation)) {
		return { icon: WrenchIcon, label: "Opened by a maintainer" };
	}
	return undefined;
}

export function AuthorMark({ item }: { item: StoredItem }): React.JSX.Element | null {
	const mark = authorMarkFor(item);
	if (!mark) {
		return null;
	}
	return <Glyph icon={mark.icon} label={mark.label} shape="chip" tone={mark.tone} />;
}
