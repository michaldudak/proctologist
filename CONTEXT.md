# PRoctologist

A personal desktop tool that audits the open pull requests of GitHub repositories the user maintains, using a coding agent to judge each one, so the user can clean the backlog, spot quick wins and stale PRs, and decide what to work on next.

## Language

**Tracked repository**:
A GitHub repository (`owner/name`) the user has configured for auditing, optionally paired with a local clone used for cross-checking against the default branch.
_Avoid_: Project, target, source

**Refresh**:
One user- or schedule-triggered fetch of a tracked repository: fetch new pull requests, update existing ones, mark closed ones, and count how many are now due for assessment. A refresh never judges anything, and never queues anything that does; assessing waits for the user to ask.
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
The agent's structured judgment about one pull request as it stood at a specific moment (head commit and last update), recorded together with the depth and the agent it was made at. Superseded, never edited, when the pull request changes.
_Avoid_: Analysis, evaluation, verdict, result

**Outdated assessment**:
An assessment whose pull request has changed since the assessment was made, or which is older than the configured age, and whose pull request is therefore pending assessment.
_Avoid_: Stale (reserved for pull requests), dirty, invalid

**Due for assessment**:
An open pull request with no current quick assessment: never assessed, changed since it was assessed, assessed but without a verdict, or with an outdated assessment. Counted by every refresh, shown on the header's primary button, and assessed only when the user asks.
_Avoid_: Pending (reads as queued), stale, unassessed (narrower: no verdict at all)

**Stale pull request**:
An open pull request with no meaningful human activity for a long time, regardless of whether it is still relevant.
_Avoid_: Abandoned (a stronger claim the assessment may or may not make), dead, outdated

**Fact**:
A property of a pull request obtained deterministically from GitHub (draft flag, labels, diff stats, whether a review was requested from the user). Facts are fetched, never judged by the agent.
_Avoid_: Metadata, attributes

**Next action**:
The single thing the user should do about a pull request, judged from the user's perspective as a maintainer. One of: Merge, Review, Continue, Nudge author, Close, Decide, Wait. Continue is reserved for pull requests the user authored.
_Avoid_: Recommendation, verdict, action item

**Priority**:
How urgent and how important it is that the user deals with a pull request, judged by the agent on its own terms: one of Critical, High, Medium, Low, with the reasoning kept alongside. Independent of the next action and of the effort: a pull request to close can be critical, and a merge-ready one can be low.
_Avoid_: Severity (a bug's property, not a pull request's), urgency and importance on their own (priority is both), rank

**Quick win**:
A pull request whose next action is Merge or Review and whose effort is XS or S. Derived from the assessment, never judged directly.
_Avoid_: Low-hanging fruit, easy PR

**Unassessed pull request**:
An open pull request for which the most recent refresh could not produce a valid assessment, with the failure reason kept alongside.
_Avoid_: Failed, errored, skipped

**Review draft**:
An agent-written review of one pull request's code, produced on the user's request and kept locally for the user to read, edit and post themselves. Distinct from the next action "Review", which means the user reviews it.
_Avoid_: Automated review, AI review, Codex review

**Job**:
A long-running unit of work the user can watch and abort. Kinds: Refresh, Assessment (the quick assessments of what was pending, or of one pull request, that the user asked for), Thorough assessment, Review draft. Jobs share one cap on concurrent agent processes; assessment jobs of one repository run one after another.
_Avoid_: Task, run, process

**Awaiting assessment**:
A pull request an assessment job is queued to judge, or is judging right now. Shown on the row so the user can see the agent working through the list.
_Avoid_: Pending, in flight, processing

**Chunk**:
The pull requests one quick-assessment agent run is handed together, at most `assessment_chunk_size` of them. Exists to spend one agent call on many pull requests rather than one each; the agent judges each on its own and may split the chunk across subagents. A chunk's assessments land together.
_Avoid_: Batch (an assessment job's counts), group, page

**Assessment depth**:
How much effort an assessment spends. **Quick** is what a refresh does for every changed pull request. **Thorough** is requested per pull request by the user and may investigate the code, run checks, or create scratch worktrees.
_Avoid_: Level, mode, deep dive

**Snoozed**:
A user annotation that hides a pull request from the default view until its assessment is replaced. Owned by the user, never set by the agent.
_Avoid_: Hidden, dismissed, muted, archived

**Note**:
Free text the user attaches to a pull request. Private to the user: never sent to the agent. Survives assessment replacement.
_Avoid_: Comment (a GitHub concept), annotation, memo
