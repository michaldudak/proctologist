# PRoctologist — Design

Agreed 2026-09-09. Vocabulary is defined in [CONTEXT.md](../CONTEXT.md); decisions with non-obvious trade-offs have their reasoning in [docs/adr](adr/). Terms in **bold** are glossary terms.

## Purpose

A resident macOS desktop app that audits the open pull requests and issues of the user's **tracked repositories** so they can clean the backlog, spot **quick wins** and **stale items**, and decide what to work on next. Pull requests are assessed; issues are **triaged**, which is the same act under the name that fits it. A personal tool, published on GitHub.

## Shape

- **Electron** app, TypeScript everywhere ([ADR 0002](adr/0002-electron-over-tauri.md)).
- An ordinary Mac app with a Dock icon. Closing the window leaves it running; Quit ends it. Launch at login optional, off by default.
- **Headless core**: `packages/core` has no Electron imports and is consumed by the app and by a thin CLI (`packages/cli`). The CLI exists for debugging, scheduling fallback and forcing the fetch/assess/present split; it never renders lists prettily.
- Layout: pnpm workspace with `packages/core`, `packages/cli`, `apps/desktop`. Vitest. `electron-vite` build, `electron-builder` producing an unsigned `.app`. No auto-update, no notarization.

## External tools

- **GitHub access exclusively through `gh`** (already authenticated). Strictly read-only: the app never comments, reviews, merges, pushes, or edits anything on GitHub.
- **A coding agent CLI**, one per **profile**, so different jobs can go to different agents. Codex through `codex exec` (`--output-schema`, `--output-last-message`, `-C <worktree>`, `-s <sandbox>`) and Claude Code through `claude --print` (`--output-format stream-json`, `--json-schema`, `--effort`). Everything an agent needs — argument spelling and event stream — lives in one dialect module; the runner above them is shared ([ADR 0006](adr/0006-one-runner-one-dialect-per-agent.md)). An agent may use `gh` and `git` inside a job; the read-only rule is enforced by prompt instruction only ([ADR 0003](adr/0003-read-only-github-by-instruction.md)). Each CLI runs under whatever login the user already gave it; the app holds no credentials of its own ([ADR 0007](adr/0007-agents-run-under-the-users-own-cli-login.md)).
- Models and effort levels are **read from the installed agent**, never hardcoded. Codex answers `codex debug models`. Claude Code has no such command: its effort levels come from `claude --help`, and its models from the catalog it caches for its own picker — a private cache, not an interface, so it is read best-effort and the model field falls back to free text whenever it cannot be understood.
- The user's identity comes from `gh auth status`, never from config.

## Domain model

Everything is keyed by repository (`owner/name`) plus item kind plus number. Both kinds live in one `items` table, whose pull-request-only columns are null for issues ([ADR 0008](adr/0008-one-items-table-for-pull-requests-and-issues.md), superseding [ADR 0004](adr/0004-items-keyed-by-repository-kind-and-number.md), which had assumed a sibling table until the foreign keys said otherwise).

| Entity             | Owner           | Notes                                                                                                                                                                                                                          |
| ------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tracked repository | config file     | `owner/name`, optional local clone path, per-repo overrides                                                                                                                                                                    |
| Item               | GitHub via `gh` | A pull request or an issue. **Facts** as last fetched; kept after close with `closed_at` and, for issues, `state_reason`; hidden by default, purged after 30 days unless a note exists                                         |
| Assessment         | agent           | Append-only; latest is current; records **depth** (quick or thorough), the head SHA and `updated_at` it was made against, the agent and model, timing, and optional `evidence[]`                                               |
| Analysis           | agent           | Markdown with Mermaid diagrams, written by a thorough assessment and keyed by it; one table of its own so listing assessments never loads it; the newest one stays readable after a quick assessment replaces the thorough one |
| Review draft       | agent           | Pull requests only. Structured findings plus summary plus verdict, markdown export, keeps the agent and its session id                                                                                                         |
| Note               | user            | One editable text per item; private ([ADR 0005](adr/0005-user-notes-are-private-to-the-user.md)); survives assessment replacement                                                                                              |
| Snoozed            | user            | Until the assessment is replaced, or until a date                                                                                                                                                                              |
| Job                | app             | Kinds: Refresh, Assessment, Thorough assessment, Review draft; abortable; row-level lock prevents two refreshes of one repository, including across app and CLI                                                                |
| Refresh record     | app             | Started, finished, outcome (completed, aborted, failed), counts of new, changed, re-assessed, unassessed, closed                                                                                                               |

Storage: one SQLite database (`better-sqlite3`, WAL mode, plain SQL, tiny migration runner, no ORM).

### Assessment fields

Facts common to both kinds (from `gh`, never asked of the agent): number, title, url, author, is_bot, author_association, authored_by_user, created_at, updated_at, labels, last_activity_by, last_activity_at.

Pull requests add: is_draft, review_requested_from_user, head_sha, base_ref, diff_stats, mergeable, review_decision, checks summary. Issues add: assignees, milestone, comment count, **votes** (thumbs up and down, the two of GitHub's eight reactions that carry an opinion), linked pull requests, state_reason when closed. Each kind's own columns are null for the other.

Judged (from the agent, via JSON schema), shared: `relevance` with reason, `effort` (XS–XL) with reason, `priority` (Critical, High, Medium, Low) with reason, `summary`, `confidence`, `evidence[]`. Three fields carry a vocabulary per kind:

| Field         | Pull request                                                                                     | Issue                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `next_action` | Merge, Review, Continue, Nudge author, Close, Decide, Wait                                       | Fix, Answer, Close as duplicate, Reproduce, Request info, Close, Decide, Wait                        |
| `status`      | Ready to merge, Waiting on maintainer, Waiting on author, Blocked on discussion, Stalled         | Needs reproduction, Awaiting reporter, Accepted, Blocked on discussion, Stalled                      |
| `area`        | Feature, Bug fix, Experiment, Refactor or chore, Docs, Dependency or infrastructure, Test, Other | Bug, Feature request, Question, Documentation, Discussion, Test, Dependency or infrastructure, Other |

`area` is one axis asked in the words that fit each kind, rather than two fields. A pull request _is_ a change and an issue _asks for_ one, so the pull request fixing a bug is a Bug fix where the issue reporting it is a Bug; Question and Discussion are an issue's answers for "no change is being asked for at all". An earlier draft had a separate `type` for issues, which turned out to duplicate three of `area`'s eight values and to rest on a glossary line — "area says where in the system it lands" — that the vocabulary never matched.

Issues add one judged field of their own: `possible_duplicate_of`, a best-effort list of issue numbers, shown in the side panel as links so the action that acts on it has somewhere to send the reporter. It is filled whenever a likely duplicate is seen, whatever the next action; Close as duplicate is reached for only when the other issue plainly covers this one.

`effort` means different things by kind, and the prompt says so. For a pull request it is the work of reviewing what is there. For an issue, judged from text alone, it is **the scope of the change being asked for** — a text-only read can tell "accept a `className` prop" from "rewrite the layout engine", and claiming more precision than that would be invention. `relevance` on an issue is judged from the signals text affords — age, whether anyone else confirmed it, whether it names a superseded version — and is explicitly allowed to land on Unclear, which a thorough triage is what resolves.

Derived: **quick win** = effort in {XS, S} and next action in {Merge, Review} for a pull request or {Fix, Answer} for an issue; Close as duplicate counts whatever the effort says, the effort judged being the change that is not going to happen while the work is a comment and a click. An issue must also clear a confidence bar (0.5), its effort and relevance having been read off prose rather than a diff, so a confident estimate surfaces and a shaky one does not — an unsure duplicate is worse than a missed one, since it sends a reporter away from a real report. "Changed since last refresh" = current assessment differs from the previous one in any judged verdict.

## Refresh pipeline

A refresh fetches and nothing more, and one refresh covers both kinds: the per-repository lock, the "Refreshed at" text and the hourly schedule are all per repository, and splitting them would double the notifications and let the two halves drift apart. Fetching is a handful of GraphQL requests, so it happens in the background on a schedule; assessing costs agent time, so it only ever happens when the user asks. The list, the "Refreshed at" text and any refresh error are all settled the moment GitHub has answered.

**Refresh job**

1. Fetch the open pull request list and the open issue list for the repository (GraphQL via `gh api graphql`, batched, REST fallback for checks and diff). Issues are fetched for every tracked repository that has opted into them; tracking a repository for pull requests never silently pulls in a thousand issues.
2. Diff against the store, per kind: new items, changed items, unchanged items, closed items (present in store, absent from the list). Store the facts and show them straight away: a first refresh of a large repository should not be a blank screen.
3. Record the refresh, with the counts per kind of what is now due. A refresh that cannot list one kind fails as a whole and previous data stays on screen.

**What is due** is never stored; it is read from the store whenever asked: items with no assessment, changed items, items whose assessment failed, plus assessments older than `outdated_after_days` (default 14). The primary button shows the count for the current destination and scope — "Assess N due" on pull requests, "Triage N due" on issues — and so does Refresh, which makes the old "Refresh all" button redundant: it is now Refresh at scope All. The menu beside the button, and the CLI's `--full`, mark every open item of that kind instead.

**What counts as changed** differs by kind, and this is the cost decision of the issues work. A pull request has changed when its head SHA or `updated_at` moved. An issue's `updated_at` moves on every label, assignee, milestone, reaction and bot comment, so using it raw would leave the due list permanently non-empty and the bill permanently running. An issue has changed when its body was edited, when a **human** left a comment after the assessment, or when it was reopened — nothing else. `last_activity_by` and `last_activity_at`, already fetched by refresh, carry exactly what that predicate needs.

**Asking to assess**

1. Work out what is due for the current kind and scope, or everything for a full run. At scope All the threshold is checked against the total, not per repository, or a run across ten repositories slips under the gate ten times over.
2. If more than `confirm_assessments_above` (default 50) or `confirm_triage_above` (default 200) are due, confirm the cost: how many items and roughly how many agent runs. It no longer offers a picker of its own — the filter bar and the checkboxes express the same choices against live counts, and better. The CLI never asks.
3. Queue one job for the chosen items. Nothing due, or nothing chosen, means no job.

**Choosing a subset** is the filter bar's job first: filter to what you want and the primary button acts on the filtered set. Checkboxes handle the exceptions within it, with `x` toggling the cursor row and `Shift`-click selecting a range. Two rules matter and both are easy to get wrong once rows are virtualized: the header checkbox means every row matching the current filters, never merely the rendered ones, and a range selection spans rows that were never rendered.

**Assessment job**

1. Refresh the persistent default-branch worktree, fetching from the remote whose URL matches the tracked repository ([ADR 0001](adr/0001-worktrees-off-the-users-clone.md)).
2. For each PR, build a bundle: metadata, body, comments, reviews, checks, diff if under `diff_cutoff_kb` (default 60) else file list plus stats, the previous two assessments reduced to verdicts plus reasons plus summary, and the repository **context** text from config.
3. Deal the PRs into **chunks** of at most `assessment_chunk_size` (default 16), sized evenly, and run one **quick assessment** per chunk through a worker pool sharing the global agent concurrency cap (default 6): `assess` profile, read-only sandbox, default-branch worktree as cwd, a small tool-call budget per PR, timeout 3 minutes per PR (a chunk gets the sum), `--ephemeral`. One agent run per chunk rather than per PR keeps the number of calls down; the prompt carries every PR's bundle in its own block, tells the agent to judge each on its own, and lets it spread them across subagents at its discretion. The reply is one entry per PR; validate each against the schema, retry once over only the PRs that came back wrong or missing, and otherwise store the PR as **unassessed** with the error. Each row shows that it is awaiting assessment, then that it is being assessed, then its verdict, as its chunk lands.
4. Report progress as assessed, unassessed and, if stopped, skipped. Assessment jobs of one repository run one after another; a stop keeps every finished assessment.

One notification per refresh and one per batch of assessments. A single PR assessed from the side panel gets none: the row is on screen already.

**Triage job** is the assessment job with three differences, and no new job kind: `jobs.item_kind` already distinguishes the two, which is what that column was for.

1. **No worktree.** A quick triage judges from text alone and never opens the code. This is the deliberate asymmetry with pull requests, and it is what makes triaging a thousand-issue backlog affordable.
2. **A smaller bundle.** Facts, body, labels, linked pull requests, and up to ten comments: the first three and the last seven, with a count of what was left out. The first three because "did anyone ever confirm this?" is the question every stale bug raises and it should not cost a tool call; the last seven because they say where the issue stands now. The agent is told what it is missing and may fetch the rest through `gh` when the ten do not explain the state.
3. **A duplicate index.** A compact list of the repository's open issue numbers and titles, capped by recency, so the agent can propose `possible_duplicate_of`. This is the one judgment a per-item pass structurally cannot make, and the prompt says the index is a hint to be confirmed rather than a claim to be trusted.

`triage_chunk_size` defaults to 16, the same as pull requests. The bundles are an order of magnitude smaller, but the ceiling on a chunk is not context — it is how many independent judgments an agent makes well in one run, and that does not change because the inputs got shorter.

**Thorough triage** (per issue, from the side panel) is where the code comes in: a default-branch worktree with a sandbox that lets the agent write inside it, so it can build, run and try to reproduce the report. There is no `refs/pull/N/head` to check out, which is the one place the pull request pipeline has no analogue. It writes an **analysis** beside its verdict as a thorough assessment does.

**Thorough assessment** (per PR, from the side panel): PR-head worktree from `refs/pull/N/head`, a sandbox that lets the agent write in its own worktree, so it can build, test and create scratch worktrees, `thorough` profile, no tool-call budget, timeout 20 minutes, same schema plus evidence plus the **analysis**, `--ephemeral`. Replaces the quick assessment. A later change to the PR yields a quick assessment again, with a "was thorough" hint and one-click re-run.

The analysis is the thorough pass's second product: Markdown in one `analysis` field of the same JSON reply, with `##` sections Background, Intuition and Walkthrough, and Mermaid fences where a picture shows the mechanism better than prose (after Geoffrey Litt's explain-diff brief, minus its quiz and its reviewing). It explains the implementation and never judges it: risks, gaps and suggestions belong to the verdict's reasons and evidence, or to the review draft, so the prompt forbids them in the analysis. Markdown rather than HTML because the agent writes it reliably inside a JSON reply, the app renders it in its own theme, and nothing the agent wrote ever runs: raw HTML is dropped, diagrams are rendered by Mermaid in strict mode. The analysis lands in the same transaction as its assessment; a thorough reply without one leaves the PR unassessed.

**Review draft** (per PR): PR-head worktree, workspace-write sandbox, `review` profile, timeout 30 minutes. The per-repository review instructions text from config is wrapped in the app's instruction to finish with the structured JSON. Repositories may reference their own skills, which the agent finds in the worktree. Session id kept for future follow-ups.

Prompts: two built-in prompt texts under version control — one for pull requests, one for issues — sharing a single builder and a single schema module, and versioned independently so tuning triage does not invalidate every stored pull request assessment through a version bump. They are separate texts rather than one template with conditionals because nearly everything kind-specific lives in the criteria prose, which is the actual product, and interleaving would make both unreadable. Per-repository free-text **context** is appended to either, and **thorough_instructions** after that on a thorough pass only. Not a full override.

Because a triage prompt invites the agent to fetch what it is missing, the read-only instruction carries more weight than it did: the agent is now expected to run `gh` on ordinary runs rather than only when it chooses to. The instruction and the test that checks for it are unchanged ([ADR 0003](adr/0003-read-only-github-by-instruction.md)), but the exposure is wider and the README says so.

## Scheduling and notifications

In-process scheduler, one global interval (default an hour, on by default), refreshes every tracked repository in sequence — both kinds in one pass — and never assesses. A refresh run notifies once, not once per repository: at scope All, ten banners is not a notification, it is a rate limit. The interval counts from the last refresh of any repository, whoever started it, so a manual refresh pushes the next scheduled one out. A refresh that is overdue on launch or on waking from sleep runs after a short grace period, once the network is back. Refreshes the user started always notify. Scheduled refreshes notify only when a PR was opened or closed, with a summary of new, closed and to-assess counts, so the user knows there is something worth assessing. A batch of assessments notifies when it finishes, with assessed, unassessed and skipped counts. Clicking a notification opens the window on that repository.

## UI

- React with **Kumo UI** (`@cloudflare/kumo`, Base UI underneath) using its standalone CSS build. No Tailwind. Custom styling in plain CSS with variables. Light and dark follow the system by default; a switcher in the header pins either one, remembered by the window and passed to Electron so the native chrome matches.
- **Navigation: the kind is the destination, the repository is a scope.** A narrow icon-only rail down the left side lists Pull requests and Issues, each with a badge carrying the due count for the current scope, and `⌘1` / `⌘2` to switch. The repository switcher stays in the header and gains **All repositories** at the top; the chosen repository persists when moving between kinds, because the workflow is "this repo, now its issues" rather than "issues, now which repo". Making cross-repository a value of a control that already exists, rather than a mode, is also what delivers the unified view for free.

  Repository was the top-level axis until now. Inverting it is what lets a future destination that is not repository-scoped join the rail at all, which a switcher-with-tabs could never have done.

- Header: a jobs button that says what is running and opens a panel listing this session's jobs, running and finished, each with its progress or outcome and a way to stop it; the repository scope; and the primary button, which always means the current destination and the current scope.
- **A destination owns its state.** Each is its own page: its filters, its columns, its sort, its cursor and its ticks belong to it and are built fresh when it is opened. The two look alike and are not the same list — different columns, different facets, different words for the same judgment — so a filter carried across would read as the app having lost its place, and a column hidden on one would take a column from the other that it does not have. The building blocks are shared; the state is not. The scope is the exception, and the only one: which repository you are looking at follows you from one destination to the other, because the workflow is "this repository, now its issues". Columns outlive the page, per kind, the way the panel's width outlives the window.
- Acting on what the checkboxes picked out belongs to the selection bar above the table, where the ticking happened; the header's primary button always means what is due.
- Table, shared between both kinds, with its columns, facets, flags and sort supplied per kind rather than branched inside it. Filter bar of search and one menu per facet plus a Show menu, each option carrying the count it would leave, and a columns menu at its end. Number and title can never be hidden.
  - Pull requests: facets author, next action, priority, area, relevance, status, effort; flags quick wins, unassessed, changed, draft, not draft, bot, maintainers, external contributors, yours, review requested, with a note, snoozed, closed; columns number, title with markers, author, next action, priority, area, relevance, status, effort, age, last activity. Default sort Merge, Review, Continue, Close, Nudge author, Decide, Wait; then quick wins, then priority.
  - Issues: facets author, next action, priority, area, relevance, status, effort; flags drop draft and review requested, keep maintainers, external contributors, bot, yours, quick wins, unassessed, changed, with a note, snoozed, closed, and gain has assignee, no reply yet, has a linked pull request, first-time reporter; columns number, title with markers, author, next action, priority, area, relevance, status, effort, votes, comments, age, last activity. Votes sort on the net, so a contested issue does not outrank a wanted one on its thumbs up alone, and the thumbs down is shown only when there is one. Default sort Fix, Answer, Reproduce, Request info, Decide, Close, Wait; then quick wins, then priority.
  - A Repository column appears when the scope is All.
- Bulk selection: a checkbox column beside the row cursor, which stays a separate thing — the cursor drives the side panel, the checkboxes drive the primary button. `x` toggles the cursor row, `Shift`-click selects a range, and the header checkbox means every row matching the filters.
- The table is windowed by Base UI's `Virtualizer` in `layout="table"` mode, which renders the `<tbody>` itself and leaves the rows as the `<tr>` elements the app returns. The table stays a real table: `<colgroup>` still sizes the columns, the sticky `<thead>` still carries `aria-sort`, and nothing sits between `<tbody>` and a row. That mode did not exist when this was designed — the component imposed its own `div` scaffold, which no `<table>` can contain — so it was asked for upstream rather than worked around here ([mui/base-ui#5466](https://github.com/mui/base-ui/pull/5466)).
  - The cursor is a key in the store and an index to the virtualizer, and `ItemTable` is the one place the two meet. The active row stays mounted even when it is outside the window, so it can hold focus and be scrolled into view — which is what makes `j`/`k` work across a list nobody has drawn.
  - `estimatedItemHeight` is the height of a real row, not an approximation of the CSS. It is what reserves space for everything not yet drawn, so an estimate under the truth leaves the scrollable height short and sends a jump to the wrong row.
  - The checkboxes are the reason the virtualizer changes nothing about selection: the header checkbox has always meant every row matching the filters rather than every row drawn, and with a window of thirty over a list of four hundred that distinction stops being academic.
- Side panel for the selected item: summary, reasons, evidence, the analysis (when it was written, whether the item has moved on since, its first paragraph, and a Read button), facts, assessment history with verdict changes, note editor, and actions: open on GitHub, snooze, re-assess or re-triage (quick), go thorough. Pull requests add drafting a review with an effort picker, and viewing or copying the draft; issues have no counterpart, and the panel's fact list follows the kind — no diff stats, checks or mergeability on an issue; assignees, milestone, linked pull requests and, once closed, the `state_reason` instead.
- Analysis reader: a modal the shape of the settings dialog, at reading width, with a table of contents built from the analysis's headings down the left, tracking what is being read, and the prose, tables and diagrams scrolling on the right. Diagrams take their colours from Kumo's tokens so they follow light and dark. Copy as Markdown; links open in the browser.
- Settings are a modal dialog over the main window, with a rail of sections (repositories, agents, refreshing, appearance) beside one scrolling pane. Five profiles would make the agents section twice as long for a setting most people set once, so inheritance is shown rather than duplicated: the triage rows read "Same as Pull requests" and expand into a full form only when overridden, which is exactly what an absent `[profiles.triage]` means in the file. Each repository's form gains a switch for whether its issues are tracked. There is no Save button: a pick or a switch is written to the config file the moment it changes, typed text when its field is left, and nothing is written while a field is invalid. Tracked repositories are listed by name, each expanding into its form (owner/name, clone folder picker, automatic remote detection with a warning if none matches, assessment instructions, review instructions), and one form adds another. First run with no tracked repositories opens the dialog on that list.
- Visual design is not bound to the reference prototype; optimise for the user's job.

## Configuration and files

Config is hand-editable and lives where command-line tools keep it; data and cache follow macOS conventions so backups, disk cleanup and uninstall tools treat them correctly.

- `~/.config/proctologist/config.toml` (or `$XDG_CONFIG_HOME/proctologist/config.toml`) is the source of truth; the app watches it and the settings dialog edits it. The directory may later hold prompt files referenced from the config.
- `~/Library/Application Support/PRoctologist/data.sqlite` is the database, included in Time Machine backups.
- `~/Library/Caches/PRoctologist/<owner>/<name>/` holds worktrees, bundles and agent logs; excluded from backups by the OS and safe to delete at any time.
- A `data_dir` key in the config overrides the database location for anyone who wants everything in one place.

```toml
schedule = { enabled = true, interval_minutes = 60 }
concurrency = 6
assessment_chunk_size = 16
triage_chunk_size = 16
outdated_after_days = 14
closed_retention_days = 30
diff_cutoff_kb = 60
confirm_assessments_above = 50
confirm_triage_above = 200

# One profile per kind of job. `agent` is "codex" or "claude"; `model` and `effort` are optional
# everywhere and, left out, the agent picks its own.
[profiles.assess]
agent = "codex"
effort = "medium"
timeout_minutes = 3

[profiles.thorough]
agent = "codex"
effort = "high"
timeout_minutes = 20

[profiles.review]
agent = "claude"
model = "opus"
effort = "high"
timeout_minutes = 30

# Left out, these inherit assess and thorough. Quick triage never reads code, so it is the one job
# that can sensibly run on a cheaper model.
[profiles.triage]
agent = "codex"
effort = "low"
timeout_minutes = 2

[[repositories]]
name = "owner/name"
clone = "/path/to/clone"
issues = true
context = "Free text appended to the assessment prompt for this repository."
thorough_instructions = "Free text appended to a thorough assessment prompt only, after the context."
review_instructions = "Free text used as the review draft prompt, e.g. use a repo skill."

# Optional per-repository overrides of any profile key, including which agent runs it.
[repositories.profiles.assess]
agent = "claude"
```

## Engineering conventions

- Repository name `proctologist`, display name PRoctologist.
- TypeScript strict, pnpm, oxlint, prettier.
- Plain imperative commit messages, no conventional-commit prefixes.
- Test-first for `packages/core` with fake `gh`, `codex` and `claude` executables on PATH returning recorded fixtures; tests alongside for the Electron shell; one live end-to-end test behind an environment flag.
- Commit after each completed piece of functionality.
- Nothing user- or repository-specific in code; no secrets in the repository.

## Non-goals for v1

Everything under Future directions, plus: multi-user or hosted anything, assessment feedback (thumbs up or down), auto-update, signing.

## Landing order

Six commits, the first of which must be verifiably behaviour-neutral — same tests, all green, before anything issue-shaped exists.

1. The mechanical rename and migration 009: `pull_requests` becomes `items`, its pull-request-only columns relax to nullable, `selectOpen` and `selectAll` gain the `kind` filter they never had, and every `{repository, number}` payload gains a `kind` — issue #42 and pull request #42 currently collide in the renderer's identity maps. No data is backfilled: every existing row already has `kind = 'pull_request'`.
2. Fetching and storing issues.
3. The triage pipeline and prompts.
4. The rail, the issues table and bulk selection.
5. Settings and the CLI.
6. The virtualizer, once it can render table markup upstream. **Done**: `layout="table"` landed on the pull request's branch, and the app takes it from a `pkg.pr.new` build until it is released.

## Future directions (recorded, not designed)

- **Tasks**: what the user means to do next, joining the rail as a third destination. Either an item they picked up or one they typed with no item behind it, so it is the first thing here that need not belong to a repository and is never judged by the agent. Carries a **stage**, a **deadline** and a **note** — three words already reserved in the glossary so nothing else takes them, since **status** is the agent's judgment, **state** is GitHub's word for open versus closed, and **due** already means awaiting assessment.
- GitHub notifications.
- A note _for the agent_, distinct from the private user note, or a chat about an assessment using kept agent sessions.
- One-click posting of a review draft behind an explicit per-click confirmation.
- Board view grouped by next action over the same data.
- Unified cross-repository view.
