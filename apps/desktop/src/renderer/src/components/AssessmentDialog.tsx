import { Button, Checkbox, Dialog, Input } from "@cloudflare/kumo";
import { useState } from "react";
import type { AssessmentQuestion, OutdatedReason } from "../../../shared/ipc.js";
import {
	REASONS,
	REASON_LABELS,
	countBots,
	countByReason,
	countDrafts,
	defaultChoices,
	selectCandidates,
} from "../lib/candidates.js";

interface AssessmentDialogProps {
	question: AssessmentQuestion;
	onAnswer: (numbers: number[] | null) => void;
}

/**
 * Asked before a refresh spends real money on a long backlog. The counts are the point: the answer
 * is usually not "all of them" or "none", but "the ones that have actually changed" or "the fifty I
 * am most likely to care about".
 */
export function AssessmentDialog({ question, onAnswer }: AssessmentDialogProps): React.JSX.Element {
	const [choices, setChoices] = useState(defaultChoices);
	const { candidates } = question;
	const byReason = countByReason(candidates);
	const bots = countBots(candidates);
	const drafts = countDrafts(candidates);
	const chosen = selectCandidates(candidates, choices);

	const setReason = (reason: OutdatedReason, value: boolean): void => {
		setChoices({ ...choices, reasons: { ...choices.reasons, [reason]: value } });
	};

	return (
		<Dialog.Root open onOpenChange={(open) => !open && onAnswer(null)}>
			<Dialog className="assessment-dialog">
				<Dialog.Title>
					Assess {candidates.length} pull requests in {question.repository}?
				</Dialog.Title>
				<Dialog.Description>
					Each one is a separate agent run, so this costs roughly a minute of agent time and tens of
					thousands of tokens per pull request. Everything left out stays unassessed and will be
					offered again next time.
				</Dialog.Description>

				<div className="dialog-group">
					<h3>Assess</h3>
					{REASONS.filter((reason) => byReason[reason] > 0).map((reason) => (
						<Checkbox
							key={reason}
							label={`${REASON_LABELS[reason]} (${String(byReason[reason])})`}
							checked={choices.reasons[reason]}
							onCheckedChange={(value) => setReason(reason, value === true)}
						/>
					))}
				</div>

				{bots > 0 || drafts > 0 ? (
					<div className="dialog-group">
						<h3>Leave out</h3>
						{bots > 0 ? (
							<Checkbox
								label={`Pull requests opened by bots (${String(bots)})`}
								checked={choices.skipBots}
								onCheckedChange={(value) => setChoices({ ...choices, skipBots: value === true })}
							/>
						) : null}
						{drafts > 0 ? (
							<Checkbox
								label={`Drafts (${String(drafts)})`}
								checked={choices.skipDrafts}
								onCheckedChange={(value) => setChoices({ ...choices, skipDrafts: value === true })}
							/>
						) : null}
					</div>
				) : null}

				<div className="dialog-group">
					<h3>How many</h3>
					<Checkbox
						label="Only the most recently active"
						checked={choices.limit !== null}
						onCheckedChange={(value) =>
							setChoices({ ...choices, limit: value === true ? 50 : null })
						}
					/>
					{choices.limit === null ? null : (
						<Input
							type="number"
							min={1}
							aria-label="How many to assess"
							value={String(choices.limit)}
							onChange={(event) =>
								setChoices({ ...choices, limit: Math.max(Number(event.target.value) || 0, 0) })
							}
						/>
					)}
				</div>

				<div className="dialog-actions">
					<Button variant="ghost" onClick={() => onAnswer(null)}>
						Not now
					</Button>
					<Button
						variant="primary"
						disabled={chosen.length === 0}
						onClick={() => onAnswer(chosen.map((candidate) => candidate.number))}
					>
						{chosen.length === candidates.length
							? `Assess all ${String(candidates.length)}`
							: `Assess ${String(chosen.length)}`}
					</Button>
				</div>
			</Dialog>
		</Dialog.Root>
	);
}
