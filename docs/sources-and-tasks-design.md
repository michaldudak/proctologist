# Sources and Tasks

Approved design for GitHub-backed Sources and independent Tasks. The user confirmed the complete design before implementation.

## Agreed scope

- The first release includes the source-provider structure, GitHub issues and pull requests, and Tasks. No other source provider ships in this release.
- AI execution continues through the existing local Codex and Claude Code CLIs. API-based AI providers and hosted AI execution are out of scope.
- GitHub is the Source provider; each tracked repository is one Source. Saved filters are deferred and do not define Sources in this release.
- GitHub Sources continue using the existing authenticated `gh` CLI. In-app GitHub sign-in and new account-management flows are outside this release.
- Gantt charts and more advanced planning tools are future directions, not part of this release.

## Tasks and Item links

- A Task is independent of its external item. The user can add an entire item to their plan or create a custom action linked to it; both create Tasks. Standalone Tasks are also supported.
- Tasks and Items have a many-to-many relationship: a Task can link to zero, one or several Items, and an Item can link to several Tasks.
- Task links can target only Items already fetched from tracked Sources, including retained closed Items. Importing arbitrary GitHub issue or PR URLs is outside this release.
- Users can delete Tasks they created by mistake or no longer intend to pursue. Delete the Task and its links without changing any external Item.
- Creating a Task from an Item copies its title as an editable starting point. Later Item title changes do not change the Task's title; the linked Item displays its current title separately.
- Retain the glossary's four Task stages: To do, Doing, Done and Blocked. Tasks can have a private Note. Creating a Task does not modify its linked Items.

## Automatic completion

- Task completion is distinct from the external item's lifecycle. Automatic completion is configured per Task and is off by default; there is no Source-level default in this release.
- When automatic completion is enabled, the user chooses exactly one linked Item to control it. Other linked Items provide context and do not trigger completion.
- Each automatically completed Task has an outcome rule: successful completion (the default: PR merged or issue closed as completed), or any closure (including a PR closed without merging or an issue closed without completing the work). A nonqualifying closure leaves the Task open.
- Reopening the controlling Item does not reopen a completed Task. Show that the Item reopened and let the user decide whether further work is needed.
- Enabling automatic completion applies the rule to the controlling Item's current known state. If its closure outcome already qualifies, saving marks the Task Done; the UI explains this before saving.
- Manually reopening a Task disables its automatic completion rule while retaining its Item links. The user can explicitly re-enable the rule later.
- Unlinking the controlling Item disables automatic completion and leaves the Task's stage unchanged. Explain this consequence beside the unlink action; do not require a replacement Item.

## Planning

- A Task has an optional planned date, separate from its deadline. Today and This week filter Tasks by that date; they are not independently assigned planning periods.
- This week is the current calendar week, using the system locale's first day of the week, rather than a rolling seven-day window.
- When a planned date passes and the Task is not Done, retain the date and show the Task in an Earlier section alongside Today's Tasks. Do not automatically reschedule it or clear its date. A passed planned date alone does not make a Task overdue; that term applies to missed deadlines.
- This week also has an Earlier section for unfinished Tasks planned before the current week. Completed Tasks from previous periods do not appear in Earlier.
- A planned date may fall after the Task's deadline. Show a visible warning and preserve both dates; do not prevent the assignment or adjust either date automatically.
- Planned dates and deadlines are calendar dates without times of day. Timeboxing and time-of-day scheduling are outside this release.

## Agent suggestions

- In addition to manual creation, the user can ask a local agent to propose actionable Tasks from selected Items. Suggestions do not become Tasks until the user accepts them, and the user can edit them before acceptance. Private Notes are excluded from agent input. This does not authorize the agent to assess or change existing Tasks.
- When proposing Tasks, the agent receives existing unfinished Tasks linked to the selected Items as context: titles, stages, planned dates, deadlines, and Item links. Do not include unrelated Tasks or private Notes.
- Task suggestions contain titles and Item links only, not scheduling. Accepted suggestions start at To do with no planned date or deadline unless the user sets them.

## Removal and retention

- Removing a Source preserves Tasks but removes their links to that Source's Items. Disable automatic completion where the removed Item controlled it, leaving the Task's stage unchanged. Preserve links to Items from other Sources.
- Automatic retention cleanup preserves Items linked to any Task, including completed Tasks. This differs from explicit Source removal, which removes the affected links.
- If an Item is deleted or becomes inaccessible, retain its cached details and Task links and mark it unavailable. Pause automatic completion until its state can be verified; do not treat absence from an open list as a qualifying closure. Keep the configured rule so it can apply once authoritative state is available again.

## Task views and ordering

- Tasks have one global destination across Sources, with Today, This week, and All views and filtering by linked Source. Each Item also shows its linked Tasks. A Task linked to several Sources remains one Task.
- Users prioritize Tasks through manual ordering. There is no separate Task priority field in this release; Item Priority remains the agent's assessment of the external Item.
- Manual order is shared across Task views. Reordering in a filtered view changes the same Tasks' relative order globally; filters do not create independent arrangements. Date sections still determine grouping.
- Today and This week show completed Tasks in a collapsed Done section, filtered by planned date. Completing a Task does not change its planned date.

## Implementation outline

Baseline inspected: master `6359e3252926ee4854b00d76929aa9cf2ef034de`.

### Source module

Introduce a small internal Source provider interface with a GitHub adapter. It covers listing a Source's Items, retrieving authoritative state for known Items, and retrieving context for assessment or Task suggestions. Keep GitHub-specific queries, `gh` invocation and state mapping inside the adapter. A complete open-list snapshot must be distinguishable from a failed or incomplete fetch.

Separate this from the existing kind-specific assessment behavior: prompts, schemas and validation for PRs and issues remain specialized. Code-review tools, clones and worktrees stay GitHub-specific; a generic Source does not require a repository checkout. Keep the existing local agent runner. Do not build a plugin discovery system, generic authentication framework, or implementations for hypothetical providers.

Give Sources stable internal identities and a provider-owned locator; for GitHub the locator is the repository. Give Items stable internal identities and provider-scoped external identities with opaque string IDs. GitHub numbers remain available for display and GitHub operations. Tasks reference internal Item identities, not `owner/repo` plus a number. The exact ID representation and migration steps are implementation details.

Keep the existing GitHub-specific detail fields for this release. Adding generic identities does not require splitting every PR/issue column into separate tables now. A later concrete provider can establish which additional detail storage it needs.

### Authoritative lifecycle tracking

The current refresh infers closure from absence in the open list. That is insufficient for Task completion: it does not establish whether a PR merged, why an issue closed, or whether an Item became inaccessible.

Fetch explicit state for known Items that disappear, and continue refreshing Task-linked closed Items so reopenings can be detected. Keep availability separate from the last-known external state. Persist enough provider facts to distinguish open, successful closure, other closure, and unknown closure outcome. Unknown or unverified success must not satisfy the successful-completion rule; a verified closure can satisfy the any-closure rule even when its reason is unknown. Failed refreshes must not complete Tasks.

Evaluate completion rules after authoritative state is persisted, and when the user saves a rule against verified cached state. Apply the existing-closed warning when replacing the controlling Item or changing the outcome rule as well. Repeated refreshes must be idempotent. Refresh may update Task stages through these explicit rules but still never queues agent assessments or suggestions automatically.

### Task module

Add Task persistence for title, stage, optional planned date and deadline, private Note, and shared manual order, plus a unique Task–Item link table. Store at most one controlling linked Item and one outcome rule per Task. Enforce that a controlling Item is actually linked.

Expose creation, editing, deletion, linking, unlinking, ordering, stage transitions and completion configuration through one Task module. Update Tasks, links and completion rules transactionally. On explicit Source removal, detach affected links and disable affected rules without deleting Tasks. Extend Item retention protection to all Task links. Keep Source removal reconciliation repeatable when configuration is edited outside the UI.

Store planned dates and deadlines as calendar dates, without conversion into UTC instants. Derive Today and This week using the user's current local calendar and system locale. Changing a view or completing a Task never rewrites either date. Use the shared manual order within date sections; a reorder changes relative order, not planned dates.

### UI and suggestions

Extend the injected application interface rather than calling core storage from the renderer. Separate navigation destinations from Item kinds so Tasks can be shown alongside PRs and issues. Standalone Tasks must remain usable with no Sources configured; the current repository-required onboarding cannot block them. All includes unplanned Tasks and provides access to completed Tasks regardless of date.

Keep existing Item selection and PR/issue filtering. Add Task creation and Task-suggestion actions to that workflow, a linked-Tasks section to Item details, and an Item picker limited to already-fetched Items for editing Task links. Preserve the existing issue opt-in per repository.

Run suggestion generation as a watchable, abortable job using the current CLI runner. Validate proposed links against the selected Items and present editable suggestions before creating anything. Explicitly construct permitted context rather than serializing Task records, so private Notes cannot leak into prompts. Acceptance creates only the suggestions selected by the user; it does not modify existing Tasks or external Items. Suggestions do not configure automatic completion.

### Migration and landing order

1. Add Source/Item identity and the GitHub adapter while preserving current PR/issue behavior. Migrate existing tracked repositories without losing issue opt-in, clones, instructions, profiles, assessments or annotations. Keep existing configuration readable; no reconnect or fresh database should be required.
2. Add authoritative lifecycle and availability tracking, with regression coverage for refresh and retention.
3. Add Task persistence, links, completion transitions and retention rules, tested through the Task module.
4. Add the global Tasks UI, planning views and Item linking, including operation with zero Sources.
5. Add user-requested Task suggestions through the existing local CLIs.

Keep the CLI's existing workflows compatible. A separate full Task-management CLI is not required by this design.

### Verification

- Migration preserves existing data and identities and does not duplicate Sources or Items on repeat startup.
- Shared Tasks appear once even when several linked Items match a Source filter.
- Both closure modes work for one controlling Item; other links never trigger completion.
- Missing, inaccessible or partially fetched Items cannot cause false completion; verified recovery resumes the configured rule.
- Enabling a matching rule completes immediately, repeated refresh does not repeat transitions, Item reopening preserves Done, and manual Task reopening disables the rule.
- Unlinking and Source removal preserve Task stage and unrelated links; retention preserves Items linked even to completed Tasks.
- Date views cover locale week boundaries, year boundaries, local midnight, Earlier sections, completed sections and unplanned Tasks without silently changing dates.
- Ordering remains consistent across filtered views.
- Suggestion acceptance is explicit, only permitted Task context reaches the agent, and private Notes are absent from prompts.

## Implementation notes

Implemented through migration 018, the Source and Task core modules, and the global Tasks destination. Suggestions use the existing global quick-assessment profile and local CLI runner; there is no additional AI provider configuration.

Suggestion requests accept at most 10 distinct Items and a 128 KiB UTF-8 prompt. Oversized requests fail before invoking the agent and ask the user to narrow the selection; content is not silently truncated.
