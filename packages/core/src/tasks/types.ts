import type { SourceItem } from "../sources/types.js";
export const TASK_STAGES = ["todo", "doing", "done", "blocked"] as const;
export type TaskStage = (typeof TASK_STAGES)[number];
export const TASK_STAGE_LABELS: Record<TaskStage, string> = {
	todo: "To do",
	doing: "Doing",
	done: "Done",
	blocked: "Blocked",
};
export interface CompletionRule {
	itemId: string;
	mode: "successful" | "any";
}
export interface Task {
	id: string;
	title: string;
	stage: TaskStage;
	plannedDate: string | null;
	deadline: string | null;
	note: string;
	position: number;
	completion: CompletionRule | null;
	items: SourceItem[];
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
}
export interface TaskInput {
	stage?: TaskStage;
	completion?: CompletionRule | null;
	title: string;
	itemIds?: string[];
	plannedDate?: string | null;
	deadline?: string | null;
	note?: string;
}
export interface TaskPatch {
	title?: string;
	stage?: TaskStage;
	plannedDate?: string | null;
	deadline?: string | null;
	note?: string;
	itemIds?: string[];
	completion?: CompletionRule | null;
}
export interface TaskFilter {
	sourceId?: string;
	itemId?: string;
}
export function qualifiesForCompletion(item: SourceItem, rule: CompletionRule): boolean {
	return (
		item.available &&
		item.verifiedAt !== null &&
		item.state === "closed" &&
		(rule.mode === "any" || item.outcome === "successful")
	);
}
export interface TaskSuggestion {
	title: string;
	itemIds: string[];
}
export interface AcceptedSuggestion extends TaskSuggestion {
	index: number;
	plannedDate?: string | null;
	deadline?: string | null;
}
export interface TaskSuggestions {
	id: string;
	itemIds: string[];
	suggestions: TaskSuggestion[] | null;
	accepted: number[];
}
