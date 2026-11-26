import { RobotIcon, UserCircleIcon, UserIcon, WrenchIcon, type Icon } from "@phosphor-icons/react";
import { isMaintainerAssociation, type StoredItem } from "@proctologist/core/browser";
import { Glyph, type GlyphTone } from "./Glyph.js";

interface Mark {
	icon: Icon;
	label: string;
	tone?: GlyphTone;
}

/**
 * What kind of author this is, as one glyph before the login. Every author gets one, so the logins
 * line up and the kind can be read down the column. The kinds are ranked: the user's own pull
 * request says so even though the user is a maintainer, and a bot is a bot whatever GitHub calls
 * its association. Anyone left is from outside the project.
 */
export function authorMarkFor(item: StoredItem): Mark {
	if (item.authoredByUser) {
		return { icon: UserCircleIcon, label: "You opened this", tone: "accent" };
	}
	if (item.isBot) {
		return { icon: RobotIcon, label: "Opened by a bot", tone: "accent" };
	}
	if (isMaintainerAssociation(item.authorAssociation)) {
		return { icon: WrenchIcon, label: "Opened by a maintainer" };
	}
	return { icon: UserIcon, label: "Opened by someone outside the project" };
}

export function AuthorMark({ item }: { item: StoredItem }): React.JSX.Element {
	const mark = authorMarkFor(item);
	return <Glyph icon={mark.icon} label={mark.label} shape="inline" tone={mark.tone} />;
}
