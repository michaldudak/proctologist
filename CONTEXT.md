# PRoctologist

A personal desktop tool that audits the open pull requests of GitHub repositories the user maintains, using Codex to judge each one, so the user can clean the backlog, spot quick wins and stale PRs, and decide what to work on next.

## Language

**Tracked repository**:
A GitHub repository (`owner/name`) the user has configured for auditing, optionally paired with a local clone used for cross-checking against the default branch.
_Avoid_: Project, target, source

**Refresh**:
One user- or schedule-triggered pass over a tracked repository: fetch new pull requests, update existing ones, and re-assess those that changed since the previous refresh.
_Avoid_: Run, audit, sync, scan

**Assessment**:
Codex's structured judgment about one pull request as it stood at a specific moment (head commit and last update), recorded together with the depth it was made at. Superseded, never edited, when the pull request changes.
_Avoid_: Analysis, evaluation, verdict, result

**Outdated assessment**:
An assessment whose pull request has changed since the assessment was made, and which the next refresh will therefore replace.
_Avoid_: Stale (reserved for pull requests), dirty, invalid

**Stale pull request**:
An open pull request with no meaningful human activity for a long time, regardless of whether it is still relevant.
_Avoid_: Abandoned (a stronger claim the assessment may or may not make), dead, outdated

**Fact**:
A property of a pull request obtained deterministically from GitHub (draft flag, labels, diff stats, whether a review was requested from the user). Facts are fetched, never judged by Codex.
_Avoid_: Metadata, attributes

**Next action**:
The single thing the user should do about a pull request, judged from the user's perspective as a maintainer. One of: Merge, Review, Continue, Nudge author, Close, Decide, Wait. Continue is reserved for pull requests the user authored.
_Avoid_: Recommendation, verdict, action item

**Quick win**:
A pull request whose next action is Merge or Review and whose effort is XS or S. Derived from the assessment, never judged directly.
_Avoid_: Low-hanging fruit, easy PR

**Unassessed pull request**:
An open pull request for which the most recent refresh could not produce a valid assessment, with the failure reason kept alongside.
_Avoid_: Failed, errored, skipped

**Review draft**:
A Codex-written review of one pull request's code, produced on the user's request and kept locally for the user to read, edit and post themselves. Distinct from the next action "Review", which means the user reviews it.
_Avoid_: Automated review, Codex review, AI review

**Job**:
A long-running unit of Codex work the user can watch and abort. Kinds: Refresh, Thorough assessment, Review draft. Jobs share one cap on concurrent Codex processes.
_Avoid_: Task, run, process

**Assessment depth**:
How much effort an assessment spends. **Quick** is what a refresh does for every changed pull request. **Thorough** is requested per pull request by the user and may investigate the code, run checks, or create scratch worktrees.
_Avoid_: Level, mode, deep dive

**Snoozed**:
A user annotation that hides a pull request from the default view until its assessment is replaced. Owned by the user, never set by Codex.
_Avoid_: Hidden, dismissed, muted, archived

**Note**:
Free text the user attaches to a pull request. Private to the user: never sent to Codex. Survives assessment replacement.
_Avoid_: Comment (a GitHub concept), annotation, memo
