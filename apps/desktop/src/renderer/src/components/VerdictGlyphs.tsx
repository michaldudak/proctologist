import {
	ArchiveIcon,
	BookOpenIcon,
	BroomIcon,
	BugIcon,
	ChatCircleIcon,
	CaretDoubleUpIcon,
	CaretDownIcon,
	CaretUpIcon,
	CheckCircleIcon,
	DotsThreeCircleIcon,
	FlaskIcon,
	HourglassIcon,
	PackageIcon,
	QuestionIcon,
	SirenIcon,
	SparkleIcon,
	TestTubeIcon,
	type Icon,
} from "@phosphor-icons/react";
import type { Area, IssueArea, Priority, Relevance } from "@proctologist/core/browser";
import { areaLabel, priorityLabel, relevanceLabel, statusLabel } from "../lib/format.js";
import { Glyph, type GlyphTone } from "./Glyph.js";

/*
 * An issue's areas are the same axis as a pull request's, in the words that suit something nobody
 * has changed yet, so the ones that mean the same thing look the same: a reported bug and a bug
 * fix share a hue and an icon. Question and Discussion are an issue's alone — they are the answers
 * that ask for no change at all.
 */
const AREA_ICONS: Record<Area | IssueArea, Icon> = {
	feature: SparkleIcon,
	bug_fix: BugIcon,
	bug: BugIcon,
	feature_request: SparkleIcon,
	documentation: BookOpenIcon,
	question: QuestionIcon,
	discussion: ChatCircleIcon,
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
const AREA_COLORS: Record<Area | IssueArea, string> = {
	feature: "var(--app-area-feature)",
	bug_fix: "var(--app-area-bug-fix)",
	bug: "var(--app-area-bug-fix)",
	feature_request: "var(--app-area-feature)",
	documentation: "var(--app-area-docs)",
	question: "var(--app-area-question)",
	discussion: "var(--app-area-discussion)",
	experiment: "var(--app-area-experiment)",
	refactor_chore: "var(--app-area-refactor-chore)",
	docs: "var(--app-area-docs)",
	dependency_infra: "var(--app-area-dependency-infra)",
	test: "var(--app-area-test)",
	other: "var(--app-area-other)",
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

/**
 * Three carets make a ramp the eye can sort a column by; critical breaks the ramp with a shape of
 * its own, because it is the one value that should stop a scan rather than rank in it.
 */
export const PRIORITY_ICONS: Record<Priority, Icon> = {
	critical: SirenIcon,
	high: CaretDoubleUpIcon,
	medium: CaretUpIcon,
	low: CaretDownIcon,
};

/** The two ends carry colour; the middle stays plain so the ends stand out from it. */
const PRIORITY_TONES: Record<Priority, GlyphTone | undefined> = {
	critical: "danger",
	high: "warn",
	medium: undefined,
	low: undefined,
};

export function AreaGlyph({ area }: { area: string }): React.JSX.Element {
	return (
		<Glyph
			icon={AREA_ICONS[area as Area | IssueArea] ?? QuestionIcon}
			label={areaLabel(area)}
			color={AREA_COLORS[area as Area | IssueArea]}
		/>
	);
}

export function PriorityGlyph({ priority }: { priority: Priority }): React.JSX.Element {
	return (
		<Glyph
			icon={PRIORITY_ICONS[priority]}
			label={priorityLabel(priority)}
			tone={PRIORITY_TONES[priority]}
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
