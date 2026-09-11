# PRoctologist

A personal desktop tool that audits the open pull requests and issues of GitHub repositories the user maintains, using a coding agent to judge each one, so the user can clean the backlog, spot quick wins and stale items, and decide what to work on next.

## Language

**Tracked repository**:
A GitHub repository (`owner/name`) the user has configured for auditing, optionally paired with a local clone used for cross-checking against the default branch.
_Avoid_: Project, target, source

**Item**:
A pull request or an issue of a tracked repository, identified by repository, kind and number. The umbrella term for anything the app fetches, lists, judges and annotates; use it whenever a statement holds for both kinds.
_Avoid_: Entry, record, object, thing, ticket

**Issue**:
A GitHub issue of a tracked repository. Fetched, listed, judged and annotated exactly as a pull request is; what differs is that it has no code of its own, so the facts about a diff, a head commit, checks and mergeability do not exist for it.
_Avoid_: Ticket, bug (one possible type of issue, not the category), task (reserved)

**Refresh**:
One user- or schedule-triggered fetch of a tracked repository, covering both kinds of item at once: fetch new pull requests and issues, update existing ones, mark closed ones, and count how many are now due for assessment. A refresh never judges anything, and never queues anything that does; assessing waits for the user to ask.
_Avoid_: Run, audit, sync, scan

**Agent**:
The coding agent CLI the app drives to do the judging: Codex or Claude Code. The app never calls a model directly; it always goes through the agent's own command line tool, using the user's own sign-in.
_Avoid_: Model, LLM, AI, Codex (only ever one of them)

**Profile**:
How one kind of job is run: which agent, on which model, at what effort, and for how long. There is one per job kind — `assess`, `thorough` and `review` — and a tracked repository may override any of them.
_Avoid_: Preset, config, settings

**Effort**:
How hard the agent is asked to think about a job. Which levels exist is the agent's business, not the app's, so they are read from the installed agent rather than written down.
_Avoid_: Reasoning effort (Codex's own word), depth (reserved for assessment depth), level

**Assessment**:
The agent's structured judgment about one item as it stood at a specific moment (head commit and last update), recorded together with the depth and the agent it was made at. Superseded, never edited, when the pull request changes.
_Avoid_: Evaluation, verdict, result; analysis (the thorough assessment's write-up)

**Triage**:
Assessing an issue: the same act, under the name that fits it. What it produces is an ordinary **assessment**, so everything said about assessments — their depth, going outdated, being due — holds for issues unchanged. The word is the user's: the app says triage wherever it means issues and assess wherever it means pull requests. A quick triage judges from the issue's text alone and never opens the code; only a thorough one does.
_Avoid_: Classification, sorting, labelling (a GitHub write the app never makes), grooming

**Outdated assessment**:
An assessment whose item has changed in a way that could change the judgment, or which is older than the configured age, and whose item is therefore pending assessment. For a pull request that means new commits or an edit; for an issue it means the body being edited, a new comment from a human, or the issue being reopened — never a label, an assignee, a milestone, a reaction or a bot's comment, which move GitHub's own timestamp without moving the judgment.
_Avoid_: Stale (reserved for items with no activity), dirty, invalid

**Due for assessment**:
An open item with no current quick assessment: never assessed, changed since it was assessed, assessed but without a verdict, or with an outdated assessment. Counted by every refresh, shown on the header's primary button, and assessed only when the user asks.
_Avoid_: Pending (reads as queued), stale, unassessed (narrower: no verdict at all)

**Stale item**:
An open pull request or issue with no meaningful human activity for a long time, regardless of whether it is still relevant.
_Avoid_: Abandoned (a stronger claim the assessment may or may not make), dead, outdated

**Fact**:
A property of an item obtained deterministically from GitHub (labels and timestamps for both kinds; the draft flag, diff stats and whether a review was requested from the user for a pull request only). Facts are fetched, never judged by the agent.
_Avoid_: Metadata, attributes

**Next action**:
The single thing the user should do about an item, judged from the user's perspective as a maintainer. Each kind has its own vocabulary: a pull request is Merge, Review, Continue, Nudge author, Close, Decide or Wait, and an issue is Fix, Answer, Reproduce, Request info, Close, Decide or Wait. Continue is reserved for pull requests the user authored.
_Avoid_: Recommendation, verdict, action item

**Status**:
Where an item has got stuck, judged by the agent. Each kind has its own vocabulary: a pull request is Ready to merge, Waiting on maintainer, Waiting on author, Blocked on discussion or Stalled, and an issue is Needs reproduction, Awaiting reporter, Accepted, Blocked on discussion or Stalled. Not to be confused with a **task**'s stage, which is the user's own and not a judgment.
_Avoid_: State (GitHub's word for open versus closed), stage (reserved for tasks), phase

**Area**:
What kind of work an item is about, judged by the agent. Each kind has its own vocabulary, because a pull request _is_ a change and an issue _asks for_ one: a pull request is a Feature, a Bug fix, a Refactor or chore and so on, while an issue is a Bug, a Feature request, a Question, a Discussion. The same axis, in the words that fit. Not where in the system the work lands, which the app does not judge.
_Avoid_: Category (its former name), type, label (a GitHub concept), component

**Priority**:
How urgent and how important it is that the user deals with an item, judged by the agent on its own terms: one of Critical, High, Medium, Low, with the reasoning kept alongside. Independent of the next action and of the effort: a pull request to close can be critical, and a merge-ready one can be low.
_Avoid_: Severity (a bug's property, not a pull request's), urgency and importance on their own (priority is both), rank

**Quick win**:
An item whose effort is XS or S and whose next action is one the user can act on immediately: Merge or Review for a pull request, Fix or Answer for an issue. Derived from the assessment, never judged directly.
_Avoid_: Low-hanging fruit, easy PR

**Unassessed item**:
An open item whose most recent assessment produced no valid verdict, with the failure reason kept alongside.
_Avoid_: Failed, errored, skipped

**Review draft**:
An agent-written review of one pull request's code, produced on the user's request and kept locally for the user to read, edit and post themselves. Pull requests only: issues have no counterpart. Distinct from the next action "Review", which means the user reviews it.
_Avoid_: Automated review, AI review, Codex review

**Job**:
A long-running unit of work the user can watch and abort. Kinds: Refresh, Assessment (the quick assessments of what was due, or of one pull request, that the user asked for), Thorough assessment, Review draft. Jobs share one cap on concurrent agent processes; assessment jobs of one repository run one after another.
_Avoid_: Task, run, process

**Awaiting assessment**:
An item an assessment job is queued to judge, or is judging right now. Shown on the row so the user can see the agent working through the list.
_Avoid_: Pending, in flight, processing

**Chunk**:
The items of one kind that a single quick-assessment agent run is handed together, at most `assessment_chunk_size` of them. Exists to spend one agent call on many items rather than one each; the agent judges each on its own and may split the chunk across subagents. A chunk's assessments land together.
_Avoid_: Batch (an assessment job's counts), group, page

**Assessment depth**:
How much effort an assessment spends. **Quick** is what an assessment job does for every item that is due; for a pull request it reads the diff, for an issue it reads only the text. **Thorough** is requested per item by the user, may investigate the code, run checks, reproduce a bug, or create scratch worktrees, and writes an analysis beside its verdict.
_Avoid_: Level, mode, deep dive

**Analysis**:
The long-form explanation a thorough assessment writes beside its verdict, so the user understands what the change does before acting: the background of the part of the system it touches, the intuition behind it with diagrams, and a walkthrough of the code. It explains and never judges; judging is the verdict's job and reviewing is the review draft's. Kept with the assessment that wrote it, and still readable, marked as describing an older version, after a quick assessment has replaced that one.
_Avoid_: Explanation, report, write-up, deep dive, review, summary (the verdict's one-liner)

**Snoozed**:
A user annotation that hides an item from the default view until its assessment is replaced, or until a date the user picked. Owned by the user, never set by the agent.
_Avoid_: Hidden, dismissed, muted, archived

**Task**:
Something the user means to do next: an item they have picked up, or one they typed themselves with no item behind it. Unlike everything else here a task need not belong to a repository and is never judged by the agent. Carries a **stage** (To do, Doing, Done, Blocked), an optional **deadline**, and a **note**. Reserved: not built, and its three words are spoken for so nothing else takes them.
_Avoid_: To-do, card, ticket, item (reserved for pull requests and issues)

**Stage**:
Where the user has put a task: To do, Doing, Done or Blocked. Owned by the user and never judged. Called stage rather than status because **status** is the agent's judgment about an item, and rather than state because GitHub uses state for open versus closed.
_Avoid_: Status, state, column, progress

**Deadline**:
The date by which the user means to finish a task. Called deadline rather than due date because **due** already means awaiting assessment.
_Avoid_: Due date, target date, when

**Note**:
Free text the user attaches to an item, or to a task. Private to the user: never sent to the agent. Survives assessment replacement.
_Avoid_: Comment (a GitHub concept), annotation, memo
