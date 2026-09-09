import {
	ArchiveIcon,
	BookOpenIcon,
	BroomIcon,
	BugIcon,
	ChatsCircleIcon,
	CheckCircleIcon,
	DotsThreeCircleIcon,
	FlaskIcon,
	GitMergeIcon,
	HourglassIcon,
	PackageIcon,
	QuestionIcon,
	SnowflakeIcon,
	SparkleIcon,
	TestTubeIcon,
	UserFocusIcon,
	UserIcon,
	type Icon,
} from "@phosphor-icons/react";
import type { Category, Relevance, Status } from "@proctologist/core/browser";
import { categoryLabel, relevanceLabel, statusLabel } from "../lib/format.js";
import { Glyph, type GlyphTone } from "./Glyph.js";

/** A taxonomy rather than a signal, so the shapes carry it alone and no colour argues with them. */
const CATEGORY_ICONS: Record<Category, Icon> = {
	feature: SparkleIcon,
	bug_fix: BugIcon,
	experiment: FlaskIcon,
	refactor_chore: BroomIcon,
	docs: BookOpenIcon,
	dependency_infra: PackageIcon,
	test: TestTubeIcon,
	other: DotsThreeCircleIcon,
};

const RELEVANCE_ICONS: Record<Relevance, Icon> = {
	still_relevant: CheckCircleIcon,
	possibly_obsolete: HourglassIcon,
	likely_obsolete: ArchiveIcon,
	unclear: QuestionIcon,
};

/** Relevance and status both run from good to bad, which is what the tones are for. */
const RELEVANCE_TONES: Record<Relevance, GlyphTone | undefined> = {
	still_relevant: "success",
	possibly_obsolete: "warn",
	likely_obsolete: "danger",
	unclear: undefined,
};

const STATUS_ICONS: Record<Status, Icon> = {
	ready_to_merge: GitMergeIcon,
	waiting_on_maintainer: UserFocusIcon,
	waiting_on_author: UserIcon,
	blocked_on_discussion: ChatsCircleIcon,
	stalled: SnowflakeIcon,
};

const STATUS_TONES: Record<Status, GlyphTone | undefined> = {
	ready_to_merge: "success",
	// The only status that is the user's turn, which is the thing they are scanning for.
	waiting_on_maintainer: "accent",
	waiting_on_author: undefined,
	blocked_on_discussion: "warn",
	stalled: "danger",
};

export function CategoryGlyph({ category }: { category: string }): React.JSX.Element {
	return (
		<Glyph
			icon={CATEGORY_ICONS[category as Category] ?? QuestionIcon}
			label={categoryLabel(category)}
		/>
	);
}

export function RelevanceGlyph({ relevance }: { relevance: string }): React.JSX.Element {
	return (
		<Glyph
			icon={RELEVANCE_ICONS[relevance as Relevance] ?? QuestionIcon}
			label={relevanceLabel(relevance)}
			tone={RELEVANCE_TONES[relevance as Relevance]}
		/>
	);
}

export function StatusGlyph({ status }: { status: string }): React.JSX.Element {
	return (
		<Glyph
			icon={STATUS_ICONS[status as Status] ?? QuestionIcon}
			label={statusLabel(status)}
			tone={STATUS_TONES[status as Status]}
		/>
	);
}
