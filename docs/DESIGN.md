# PRoctologist — Design

Agreed 2026-09-09. Vocabulary is defined in [CONTEXT.md](../CONTEXT.md); decisions with non-obvious trade-offs have their reasoning in [docs/adr](adr/). Terms in **bold** are glossary terms.

## Purpose

A resident macOS desktop app that audits the open pull requests of the user's **tracked repositories** so they can clean the backlog, spot **quick wins** and **stale pull requests**, and decide what to work on next. A personal tool, published on GitHub.

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

Everything is keyed by repository (`owner/name`) plus item kind plus number ([ADR 0004](adr/0004-items-keyed-by-repository-kind-and-number.md)).

| Entity             | Owner           | Notes                                                                                                                                                                                                                          |
| ------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tracked repository | config file     | `owner/name`, optional local clone path, per-repo overrides                                                                                                                                                                    |
| Pull request       | GitHub via `gh` | **Facts** as last fetched; kept after close with `closed_at`, hidden by default, purged after 30 days unless a note exists                                                                                                     |
| Assessment         | agent           | Append-only; latest is current; records **depth** (quick or thorough), the head SHA and `updated_at` it was made against, the agent and model, timing, and optional `evidence[]`                                               |
| Analysis           | agent           | Markdown with Mermaid diagrams, written by a thorough assessment and keyed by it; one table of its own so listing assessments never loads it; the newest one stays readable after a quick assessment replaces the thorough one |
| Review draft       | agent           | Structured findings plus summary plus verdict, markdown export, keeps the agent and its session id                                                                                                                             |
| Note               | user            | One editable text per PR; private ([ADR 0005](adr/0005-user-notes-are-private-to-the-user.md)); survives assessment replacement                                                                                                |
| Snoozed            | user            | Until the assessment is replaced, or until a date                                                                                                                                                                              |
| Job                | app             | Kinds: Refresh, Assessment, Thorough assessment, Review draft; abortable; row-level lock prevents two refreshes of one repository, including across app and CLI                                                                |
| Refresh record     | app             | Started, finished, outcome (completed, aborted, failed), counts of new, changed, re-assessed, unassessed, closed                                                                                                               |

Storage: one SQLite database (`better-sqlite3`, WAL mode, plain SQL, tiny migration runner, no ORM).

### Assessment fields

Facts (from `gh`, never asked of the agent): number, title, url, author, is_bot, authored_by_user, review_requested_from_user, created_at, updated_at, is_draft, labels, head_sha, base_ref, diff_stats, mergeable, review_decision, checks summary, last_activity_by, last_activity_at.

Judged (from the agent, via JSON schema): `next_action` (Merge, Review, Continue, Nudge author, Close, Decide, Wait) with `next_action_reason`, `area`, `relevance` with reason, `status` with reason, `effort` (XS–XL) with reason, `priority` (Critical, High, Medium, Low) with reason, `summary`, `confidence`, `evidence[]`.

Derived: **quick win** = next action in {Merge, Review} and effort in {XS, S}. "Changed since last refresh" = current assessment differs from the previous one in any judged verdict.

## Refresh pipeline

A refresh fetches and nothing more. Fetching is a handful of GraphQL requests, so it happens in the background on a schedule; assessing costs agent time, so it only ever happens when the user asks. The list, the "Refreshed at" text and any refresh error are all settled the moment GitHub has answered.

**Refresh job**

1. Fetch the open PR list for the repository (GraphQL via `gh api graphql`, batched, REST fallback for checks and diff).
2. Diff against the store: new PRs, changed PRs (head SHA or `updated_at` differs from the current assessment), unchanged PRs, closed PRs (present in store, absent from the list). Store the facts and show them straight away: a first refresh of a large repository should not be a blank screen.
3. Record the refresh, with the count of what is now due. A refresh that cannot list PRs fails as a whole and previous data stays on screen.

**What is due** is never stored; it is read from the store whenever asked: PRs with no assessment, changed PRs, PRs whose assessment failed, plus assessments older than `outdated_after_days` (default 14). The header shows the count on its primary button, "Assess N due". "Re-assess all" and the CLI's `--full` mark every open PR instead.

**Asking to assess**

1. Work out what is due, or everything for a full run.
2. If more than `confirm_assessments_above` (default 50) are due, ask which of them to assess: by reason (never assessed, changed, failed, aged out), leaving out bots or drafts, or capped at the most recently active. The CLI never asks.
3. Queue one assessment job for the chosen PRs. Nothing due, or nothing chosen, means no job.

**Assessment job**

1. Refresh the persistent default-branch worktree, fetching from the remote whose URL matches the tracked repository ([ADR 0001](adr/0001-worktrees-off-the-users-clone.md)).
2. For each PR, build a bundle: metadata, body, comments, reviews, checks, diff if under `diff_cutoff_kb` (default 60) else file list plus stats, the previous two assessments reduced to verdicts plus reasons plus summary, and the repository **context** text from config.
3. Deal the PRs into **chunks** of at most `assessment_chunk_size` (default 16), sized evenly, and run one **quick assessment** per chunk through a worker pool sharing the global agent concurrency cap (default 6): `assess` profile, read-only sandbox, default-branch worktree as cwd, a small tool-call budget per PR, timeout 3 minutes per PR (a chunk gets the sum), `--ephemeral`. One agent run per chunk rather than per PR keeps the number of calls down; the prompt carries every PR's bundle in its own block, tells the agent to judge each on its own, and lets it spread them across subagents at its discretion. The reply is one entry per PR; validate each against the schema, retry once over only the PRs that came back wrong or missing, and otherwise store the PR as **unassessed** with the error. Each row shows that it is awaiting assessment, then that it is being assessed, then its verdict, as its chunk lands.
4. Report progress as assessed, unassessed and, if stopped, skipped. Assessment jobs of one repository run one after another; a stop keeps every finished assessment.

One notification per refresh and one per batch of assessments. A single PR assessed from the side panel gets none: the row is on screen already.

**Thorough assessment** (per PR, from the side panel): PR-head worktree from `refs/pull/N/head`, a sandbox that lets the agent write in its own worktree, so it can build, test and create scratch worktrees, `thorough` profile, no tool-call budget, timeout 20 minutes, same schema plus evidence plus the **analysis**, `--ephemeral`. Replaces the quick assessment. A later change to the PR yields a quick assessment again, with a "was thorough" hint and one-click re-run.

The analysis is the thorough pass's second product: Markdown in one `analysis` field of the same JSON reply, with `##` sections Background, Intuition and Walkthrough, and Mermaid fences where a picture shows the mechanism better than prose (after Geoffrey Litt's explain-diff brief, minus its quiz and its reviewing). It explains the implementation and never judges it: risks, gaps and suggestions belong to the verdict's reasons and evidence, or to the review draft, so the prompt forbids them in the analysis. Markdown rather than HTML because the agent writes it reliably inside a JSON reply, the app renders it in its own theme, and nothing the agent wrote ever runs: raw HTML is dropped, diagrams are rendered by Mermaid in strict mode. The analysis lands in the same transaction as its assessment; a thorough reply without one leaves the PR unassessed.

**Review draft** (per PR): PR-head worktree, workspace-write sandbox, `review` profile, timeout 30 minutes. The per-repository review instructions text from config is wrapped in the app's instruction to finish with the structured JSON. Repositories may reference their own skills, which the agent finds in the worktree. Session id kept for future follow-ups.

Prompts: one built-in assessment prompt under version control, plus per-repository free-text **context** appended to it, and **thorough_instructions** appended after that on a thorough pass only. Not a full override.

## Scheduling and notifications

In-process scheduler, one global interval (default an hour, on by default), refreshes every tracked repository in sequence, and never assesses. The interval counts from the last refresh of any repository, whoever started it, so a manual refresh pushes the next scheduled one out. A refresh that is overdue on launch or on waking from sleep runs after a short grace period, once the network is back. Refreshes the user started always notify. Scheduled refreshes notify only when a PR was opened or closed, with a summary of new, closed and to-assess counts, so the user knows there is something worth assessing. A batch of assessments notifies when it finishes, with assessed, unassessed and skipped counts. Clicking a notification opens the window on that repository.

## UI

- React with **Kumo UI** (`@cloudflare/kumo`, Base UI underneath) using its standalone CSS build. No Tailwind. Custom styling in plain CSS with variables. Light and dark follow the system by default; a switcher in the header pins either one, remembered by the window and passed to Electron so the native chrome matches.
- Main window: repository switcher; a jobs button in the header that says what is running and opens a panel listing this session's jobs, running and finished, each with its progress or outcome and a way to stop it; a table of open PRs with a filter bar of search and one menu per facet (author, next action, priority, area, relevance, status, effort) plus a Show menu (quick wins, unassessed, changed, draft, not draft, bot, yours, review requested, with a note; snoozed and closed), each option carrying the count it would leave, and at its end a columns menu choosing which columns the table shows; columns number, title with markers (draft, bot, yours, review requested, note, assessed thoroughly, changed, snoozed, awaiting assessment, being assessed), author, next action, priority, area, relevance, status, effort, age, last activity, of which number and title cannot be hidden and status is hidden until asked for. Default sort by next action: Merge, Review, Continue, Close, Nudge author, Decide, Wait; then quick wins, then priority.
- Side panel for the selected PR: summary, reasons, evidence, the analysis (when it was written, whether the PR has moved on since, its first paragraph, and a Read button), facts, assessment history with verdict changes, note editor, and actions: open on GitHub, snooze, re-assess (quick), assess thoroughly, draft review with an effort picker, view or copy review draft.
- Analysis reader: a modal the shape of the settings dialog, at reading width, with a table of contents built from the analysis's headings down the left, tracking what is being read, and the prose, tables and diagrams scrolling on the right. Diagrams take their colours from Kumo's tokens so they follow light and dark. Copy as Markdown; links open in the browser.
- Settings are a modal dialog over the main window, with a rail of sections (repositories, agents, refreshing, appearance) beside one scrolling pane. There is no Save button: a pick or a switch is written to the config file the moment it changes, typed text when its field is left, and nothing is written while a field is invalid. Tracked repositories are listed by name, each expanding into its form (owner/name, clone folder picker, automatic remote detection with a warning if none matches, assessment instructions, review instructions), and one form adds another. First run with no tracked repositories opens the dialog on that list.
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
outdated_after_days = 14
closed_retention_days = 30
diff_cutoff_kb = 60
confirm_assessments_above = 50

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

[[repositories]]
name = "owner/name"
clone = "/path/to/clone"
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

## Future directions (recorded, not designed)

- Issues audit reusing the pipeline (planned first).
- GitHub notifications.
- Personal to-do list fed by next actions.
- A note _for the agent_, distinct from the private user note, or a chat about an assessment using kept agent sessions.
- One-click posting of a review draft behind an explicit per-click confirmation.
- Board view grouped by next action over the same data.
- Unified cross-repository view.
