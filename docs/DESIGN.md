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
- **Codex through `codex exec`** with `--output-schema`, `--output-last-message`, `-C <worktree>`. Codex may use `gh` and `git` inside a job; the read-only rule is enforced by prompt instruction only ([ADR 0003](adr/0003-read-only-github-by-instruction.md)).
- The user's identity comes from `gh auth status`, never from config.

## Domain model

Everything is keyed by repository (`owner/name`) plus item kind plus number ([ADR 0004](adr/0004-items-keyed-by-repository-kind-and-number.md)).

| Entity             | Owner           | Notes                                                                                                                                                              |
| ------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tracked repository | config file     | `owner/name`, optional local clone path, per-repo overrides                                                                                                        |
| Pull request       | GitHub via `gh` | **Facts** as last fetched; kept after close with `closed_at`, hidden by default, purged after 30 days unless a note exists                                         |
| Assessment         | Codex           | Append-only; latest is current; records **depth** (quick or thorough), the head SHA and `updated_at` it was made against, model, timing, and optional `evidence[]` |
| Review draft       | Codex           | Structured findings plus summary plus verdict, markdown export, keeps the Codex session id                                                                         |
| Note               | user            | One editable text per PR; private ([ADR 0005](adr/0005-user-notes-are-private-to-the-user.md)); survives assessment replacement                                    |
| Snoozed            | user            | Until the assessment is replaced, or until a date                                                                                                                  |
| Job                | app             | Kinds: Refresh, Thorough assessment, Review draft; abortable; row-level lock prevents two refreshes of one repository, including across app and CLI                |
| Refresh record     | app             | Started, finished, outcome (completed, aborted, failed), counts of new, changed, re-assessed, unassessed, closed                                                   |

Storage: one SQLite database (`better-sqlite3`, WAL mode, plain SQL, tiny migration runner, no ORM).

### Assessment fields

Facts (from `gh`, never asked of Codex): number, title, url, author, is_bot, authored_by_user, review_requested_from_user, created_at, updated_at, is_draft, labels, head_sha, base_ref, diff_stats, mergeable, review_decision, checks summary, last_activity_by, last_activity_at.

Judged (from Codex, via JSON schema): `next_action` (Merge, Review, Continue, Nudge author, Close, Decide, Wait) with `next_action_reason`, `category`, `relevance` with reason, `status` with reason, `effort` (XS–XL) with reason, `summary`, `confidence`, `evidence[]`.

Derived: **quick win** = next action in {Merge, Review} and effort in {XS, S}. "Changed since last refresh" = current assessment differs from the previous one in any judged verdict.

## Refresh pipeline

1. Fetch the open PR list for the repository (GraphQL via `gh api graphql`, batched, REST fallback for checks and diff).
2. Diff against the store: new PRs, changed PRs (head SHA or `updated_at` differs from the current assessment), unchanged PRs, closed PRs (present in store, absent from the list). Store the facts and show them straight away, marked as awaiting assessment: a first refresh of a large repository should not be a blank screen for ten minutes.
3. Mark **outdated assessments**: changed PRs, plus assessments older than `outdated_after_days` (default 14). `--full` or the force-refresh control marks everything.
4. If more than `confirm_assessments_above` (default 50) are due, ask which of them to assess: by reason (never assessed, changed, failed, aged out), leaving out bots or drafts, or capped at the most recently active. Scheduled refreshes and the CLI never ask.
5. Refresh the persistent default-branch worktree, fetching from the remote whose URL matches the tracked repository ([ADR 0001](adr/0001-worktrees-off-the-users-clone.md)).
6. For each chosen PR, build a bundle: metadata, body, comments, reviews, checks, diff if under `diff_cutoff_kb` (default 60) else file list plus stats, the previous two assessments reduced to verdicts plus reasons plus summary, and the repository **context** text from config.
7. Run **quick assessments** through a worker pool sharing the global Codex concurrency cap (default 6): `assess` profile, read-only sandbox, default-branch worktree as cwd, a small tool-call budget, timeout 3 minutes, `--ephemeral`. Validate against the schema; retry once; otherwise store the PR as **unassessed** with the error. Rows fill in as assessments land.
8. Record the refresh; notify; open or focus the window.

Abort keeps completed assessments and records the refresh as aborted. A refresh that cannot list PRs fails as a whole and previous data stays on screen.

**Thorough assessment** (per PR, from the side panel): PR-head worktree from `refs/pull/N/head`, workspace-write sandbox so Codex can build, test and create scratch worktrees, `thorough` profile, no tool-call budget, timeout 20 minutes, same schema plus evidence, `--ephemeral`. Replaces the quick assessment. A later change to the PR yields a quick assessment again, with a "was thorough" hint and one-click re-run.

**Review draft** (per PR): PR-head worktree, workspace-write sandbox, `review` profile, timeout 30 minutes. The per-repository review instructions text from config is wrapped in the app's instruction to finish with the structured JSON. Repositories may reference their own Codex skills, which Codex finds in the worktree's `.agents/skills`. Session id kept for future follow-ups.

Prompts: one built-in assessment prompt under version control, plus per-repository free-text **context** appended to it. Not a full override.

## Scheduling and notifications

In-process scheduler, one global daily time, off by default, refreshes every tracked repository in sequence, runs once on wake if the time was missed. Refreshes the user started always notify on completion. Scheduled refreshes notify only when something changed, with a summary of new, re-assessed and quick-win counts. No automatic refresh on launch. Clicking a notification opens the window on that repository.

## UI

- React with **Kumo UI** (`@cloudflare/kumo`, Base UI underneath) using its standalone CSS build. No Tailwind. Custom styling in plain CSS with variables. Light and dark follow the system.
- Main window: repository switcher; a table of open PRs with filter chips carrying counts (next action, category, relevance, status, effort, draft, bot, yours, review requested, snoozed, closed); search; columns number, title with markers (draft, bot, yours, review requested, note, changed), next action, category, relevance, status, effort, age, last activity. Default sort by next action priority: Merge, Review, Continue, Close, Nudge author, Decide, Wait.
- Side panel for the selected PR: summary, reasons, evidence, facts, assessment history with verdict changes, note editor, and actions: open on GitHub, snooze, re-assess (quick), assess thoroughly, draft review with an effort picker, view or copy review draft.
- First run with no tracked repositories shows an Add repository form (owner/name, clone folder picker, automatic remote detection with a warning if none matches) that writes the config file. The same form serves the settings screen.
- Visual design is not bound to the reference prototype; optimise for the user's job.

## Configuration and files

Config is hand-editable and lives where command-line tools keep it; data and cache follow macOS conventions so backups, disk cleanup and uninstall tools treat them correctly.

- `~/.config/proctologist/config.toml` (or `$XDG_CONFIG_HOME/proctologist/config.toml`) is the source of truth; the app watches it and the settings screen edits it. The directory may later hold prompt files referenced from the config.
- `~/Library/Application Support/PRoctologist/data.sqlite` is the database, included in Time Machine backups.
- `~/Library/Caches/PRoctologist/<owner>/<name>/` holds worktrees, bundles and Codex logs; excluded from backups by the OS and safe to delete at any time.
- A `data_dir` key in the config overrides the database location for anyone who wants everything in one place.

```toml
schedule = { enabled = false, time = "08:00" }
concurrency = 6
outdated_after_days = 14
closed_retention_days = 30
diff_cutoff_kb = 60
confirm_assessments_above = 50

# `model` is optional everywhere; left out, Codex picks its own default.
[codex.profiles.assess]
reasoning_effort = "medium"
timeout_minutes = 3

[codex.profiles.thorough]
reasoning_effort = "high"
timeout_minutes = 20

[codex.profiles.review]
reasoning_effort = "high"
timeout_minutes = 30

[[repositories]]
name = "owner/name"
clone = "/path/to/clone"
context = "Free text appended to the assessment prompt for this repository."
review_instructions = "Free text used as the review draft prompt, e.g. use a repo skill."

# Optional per-repository overrides of any profile key.
[repositories.codex.profiles.assess]
model = "..."
```

## Engineering conventions

- Repository name `proctologist`, display name PRoctologist.
- TypeScript strict, pnpm, oxlint, prettier.
- Plain imperative commit messages, no conventional-commit prefixes.
- Test-first for `packages/core` with fake `gh` and `codex` executables on PATH returning recorded fixtures; tests alongside for the Electron shell; one live end-to-end test behind an environment flag.
- Commit after each completed piece of functionality.
- Nothing user- or repository-specific in code; no secrets in the repository.

## Non-goals for v1

Everything under Future directions, plus: multi-user or hosted anything, assessment feedback (thumbs up or down), auto-update, signing.

## Future directions (recorded, not designed)

- Issues audit reusing the pipeline (planned first).
- GitHub notifications.
- Personal to-do list fed by next actions.
- A note _for the agent_, distinct from the private user note, or a chat about an assessment using kept Codex sessions.
- One-click posting of a review draft behind an explicit per-click confirmation.
- Board view grouped by next action over the same data.
- Unified cross-repository view.
