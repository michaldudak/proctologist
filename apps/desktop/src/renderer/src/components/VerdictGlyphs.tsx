import {
	ArchiveIcon,
	BookOpenIcon,
	BroomIcon,
	BugIcon,
	CheckCircleIcon,
	DotsThreeCircleIcon,
	FlaskIcon,
	HourglassIcon,
	PackageIcon,
	QuestionIcon,
	SparkleIcon,
	TestTubeIcon,
	type Icon,
} from "@phosphor-icons/react";
import type { Category, Relevance } from "@proctologist/core/browser";
import { categoryLabel, relevanceLabel, statusLabel } from "../lib/format.js";
import { Glyph, type GlyphTone } from "./Glyph.js";

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

/**
 * A taxonomy, not a signal: the hues only have to differ from each other, never to rank. They live
 * in app.css, where light and dark stay together; this says which one, not what it is.
 */
const CATEGORY_COLORS: Record<Category, string> = {
	feature: "var(--app-category-feature)",
	bug_fix: "var(--app-category-bug-fix)",
	experiment: "var(--app-category-experiment)",
	refactor_chore: "var(--app-category-refactor-chore)",
	docs: "var(--app-category-docs)",
	dependency_infra: "var(--app-category-dependency-infra)",
	test: "var(--app-category-test)",
	other: "var(--app-category-other)",
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

export function CategoryGlyph({ category }: { category: string }): React.JSX.Element {
	return (
		<Glyph
			icon={CATEGORY_ICONS[category as Category] ?? QuestionIcon}
			label={categoryLabel(category)}
			color={CATEGORY_COLORS[category as Category]}
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

/**
 * The one verdict field that stays in words, and stays plain: five statuses is past what shape
 * alone separates at a glance, and a table that colours every column colours none of them.
 */
export function StatusText({ status }: { status: string }): React.JSX.Element {
	return <>{statusLabel(status)}</>;
}
