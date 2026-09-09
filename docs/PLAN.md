# PRoctologist — Implementation plan

Derived from [DESIGN.md](DESIGN.md). Milestones are ordered by dependency; each ends in a working, tested state and at least one commit. Core work is test-first. Nothing user- or repository-specific goes into code.

## Module map

`packages/core` is a set of deep modules with narrow interfaces. Every external process is injected as an executable path so tests can substitute fakes on PATH.

| Module    | Interface (sketch)                                                                                                        | Hides                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `config`  | `loadConfig()`, `watchConfig(cb)`, `writeConfig(patch)`, `resolvePaths()`                                                 | TOML parsing, XDG and macOS paths, defaults, per-repository override merging        |
| `store`   | `openStore(path)` returning typed repositories: `pullRequests`, `assessments`, `notes`, `snoozes`, `jobs`, `refreshes`    | SQLite, migrations, WAL, purge rules                                                |
| `github`  | `GitHubClient`: `viewer()`, `listOpenPullRequests(repo)`, `pullRequestBundle(repo, n)`                                    | `gh` invocation, GraphQL batching, REST fallbacks, pagination, fact derivation      |
| `git`     | `WorktreeManager`: `defaultBranch(repo)`, `pullHead(repo, n)`, `release(handle)`, `pruneAll()`                            | remote matching by URL, fetch, worktree lifecycle, cache layout                     |
| `codex`   | `CodexRunner.run({ profile, cwd, prompt, schema, sandbox, timeout, signal })` returning parsed JSON, session id, log path | `codex exec` flags, ephemeral vs kept sessions, timeouts, abort, output parsing     |
| `assess`  | `buildAssessmentPrompt(input)`, `assessmentSchema`, `validateAssessment()`                                                | the built-in prompt, bundle formatting, prior-assessment reduction, evidence        |
| `review`  | `buildReviewPrompt(input)`, `reviewSchema`, `toMarkdown(draft)`                                                           | wrapping repository instructions, structured output                                 |
| `jobs`    | `JobRunner`: `enqueue(job)`, `abort(id)`, `onProgress(cb)`, `list()`                                                      | shared Codex concurrency cap, per-repository refresh lock, persistence of job state |
| `refresh` | `runRefresh(repo, { full })`, `runThoroughAssessment(repo, n)`, `runReviewDraft(repo, n, effort)`                         | the pipeline itself; composes everything above                                      |
| `derive`  | `quickWin()`, `changedSinceLast()`, `nextActionOrder`                                                                     | derived fields shared by CLI and UI                                                 |

`packages/cli` is a thin command dispatcher over `refresh` and `jobs`. `apps/desktop` hosts `core` in the Electron main process and exposes a typed IPC surface to the React renderer.

## Milestones

### M0. Workspace, tooling and risk spikes

- pnpm workspace, TypeScript strict with project references, Vitest, oxlint, prettier, `engines`, GitHub Actions running lint and tests.
- Package skeletons: `packages/core`, `packages/cli`, `apps/desktop` (empty shells).
- Three throwaway spikes, results noted in this file under "Spike findings" and deleted afterwards:
  1. `codex exec` with `--output-schema`, `--output-last-message`, `--ephemeral`, `-s read-only`, `-C` on a real worktree: confirm the last message is schema-conformant JSON and what an abort via SIGTERM leaves behind.
  2. `better-sqlite3` inside Electron with `electron-vite`: confirm the native rebuild path works.
  3. Kumo standalone CSS in a Vite renderer: confirm dark mode via `data-mode` and that custom CSS can reference Kumo's tokens.
- Done when `pnpm lint`, `pnpm test` and `pnpm typecheck` pass on an empty workspace and the spikes have answers.

### M1. `config`

- Types for the whole config file from DESIGN.md. Defaults, validation with clear errors naming the key.
- Path resolution: `$XDG_CONFIG_HOME` or `~/.config`, Application Support, Caches, `data_dir` override.
- Per-repository override merge for Codex profiles.
- `watchConfig` with debounce; `writeConfig` preserving comments where the TOML library allows, otherwise round-tripping cleanly.
- Tests: defaults, overrides, invalid files, path resolution with env vars.

### M2. `store`

- Schema (all keyed by `repo`, `kind`, `number` where applicable):
  - `pull_requests`: facts columns, `closed_at`, `fetched_at`.
  - `assessments`: append-only, `depth`, `head_sha`, `updated_at_seen`, judged fields, `evidence` JSON, `model`, `duration_ms`, `error` for unassessed, `created_at`.
  - `notes`, `snoozes` (`until_change` boolean, `until_date`).
  - `review_drafts`: findings JSON, summary, verdict, `session_id`, `head_sha`.
  - `jobs`: kind, repo, target, state, progress, `started_at`, `finished_at`, `error`; a partial unique index enforcing one running refresh per repo.
  - `refreshes`: outcome and counts.
- Migration runner with numbered SQL files. WAL mode.
- Queries: current assessment per PR, outdated set given `outdated_after_days`, changed-since-last, purge of closed PRs respecting notes.
- Tests against a temp database for every query and the purge rules.

### M3. `github`

- `gh` wrapper: spawn, JSON parse, error mapping (not authenticated, rate limited, not found).
- `viewer()` from `gh api user`.
- `listOpenPullRequests` via GraphQL with pagination, mapping to facts including `authored_by_user`, `review_requested_from_user`, `last_activity_*`.
- `pullRequestBundle`: body, comments, reviews, review threads, checks summary, diff with cutoff, file list.
- Fixture recorder script that captures real responses into `fixtures/` with logins and repo names scrubbed, and a fake `gh` executable that replays them.
- Tests on fixtures for mapping and pagination.

### M4. `git`

- Find the remote whose URL matches `owner/name` across ssh and https forms; error if none.
- Default-branch worktree under Caches: create if missing, `fetch` then `checkout --detach` to the remote head on each refresh.
- Pull-head worktrees from `refs/pull/N/head`, handle objects, release and prune. Prune all `proctologist-*` worktrees at startup.
- Tests on a temporary bare repository acting as remote plus a clone.

### M5. `codex`

- Build the `codex exec` argument list from a profile: model, reasoning effort, sandbox, `-C`, schema file, last-message file, `--ephemeral` or not, `--skip-git-repo-check` when needed.
- Timeout and abort via `AbortSignal`, process-group kill so child shells die too.
- Capture stdout and stderr to a log file in Caches; parse the last message; return session id when kept.
- Fake `codex` executable for tests that returns canned JSON, delays, or garbage.
- Tests: argument construction per profile, timeout, abort, invalid output surfaced.

### M6. `assess`

- JSON schema for the assessment with enums from CONTEXT.md.
- Built-in prompt as a versioned text asset with the read-only GitHub instruction, the criteria for each verdict, the tool-call budget for quick, and the investigation licence for thorough.
- Prompt builder: bundle, repository context, previous two assessments reduced, facts block. A test asserts the builder has no access to notes.
- Validation and one retry with the validation error appended.
- Tests: snapshot of a built prompt from a fixture bundle, schema validation edge cases.

### M7. `jobs`, `refresh`, CLI

- `JobRunner`: queue, shared concurrency cap read from config, refresh lock per repo via the store, abort, progress events, persisted state so a crash leaves jobs marked failed on next start.
- `runRefresh`: the seven pipeline steps from DESIGN.md, with counts and the refresh record. `runThoroughAssessment`. Closed-PR handling and purge.
- CLI: `refresh <owner/name> [--full]`, `assess <owner/name> <n> [--thorough]`, `jobs`, `abort <id>`. Exit codes. Progress on stderr.
- Live end-to-end test behind `PROCTOLOGIST_LIVE=1` against a repository named by env var.
- Done when a real refresh over a real repository completes in minutes and the database holds assessments. First tuning pass on the prompt happens here.

### M8. `review`

- Review draft schema: findings with file, line, severity, text; summary; verdict.
- Prompt wrapper around the repository's `review_instructions`, with effort placeholder, plus the read-only instruction.
- Markdown export. Session id kept. CLI `review <owner/name> <n> [--effort]`.
- Tests: wrapper snapshot, markdown export, schema validation.

### M9. Desktop shell (main process)

- `electron-vite` app hosting `core`. Single instance lock.
- Typed IPC contract in `apps/desktop/src/shared/ipc.ts`: queries (repositories, pull requests with current assessment and derived fields, assessment history, review draft, jobs), commands (refresh, refreshAll, abort, assessThorough, draftReview, snooze, unsnooze, setNote, openOnGitHub, writeConfig), events (job progress, data changed, config changed).
- Tray with the three icon states and the menu from DESIGN.md. Main window lifecycle: hide on close, show from tray.
- Notifications with click routing to the repository. Scheduler with missed-run catch-up on wake via `powerMonitor`.
- Config watcher feeding the renderer. Startup prune of worktrees and orphaned jobs.
- Tests for the scheduler and IPC handlers with a fake core.

### M10. Renderer

Split into three commits-worth of work:

1. **Read-only views**: Kumo setup, repository switcher, PR table with filter chips and counts, search, sort with the next-action priority, markers, side panel with summary, reasons, evidence, facts, assessment history. Light and dark.
2. **Actions and jobs**: refresh button with progress and abort, re-assess, assess thoroughly, draft review with effort picker, review draft view and copy, snooze, note editor, unviewed-changes marker.
3. **Settings and first run**: Add repository form with folder picker, remote detection and warning; settings screen editing profiles, schedule and defaults through `writeConfig`; empty state on first launch.

Visual design is fresh, not the prototype. Component tests where logic exists (filtering, sorting, derived counts); the rest is checked by running the app.

### M11. Packaging and docs

- `electron-builder` configuration producing an unsigned `.app`, native module rebuild, app icon.
- Launch at login toggle.
- README: install, first run, config reference, CLI reference, how read-only is enforced and its limits, how to delete cache and data.
- Done when a fresh clone can `pnpm install && pnpm dist` and the app runs from Applications.

## Sequencing and parallelism

M1 through M6 are independent of each other apart from shared types and can be built in any order after M0; M7 needs all of them. M8 needs M5 and M7. M9 needs M7 and M8. M10 needs M9. M11 last. If work is split across agents, M1 to M6 are the natural parallel slice.

## Cross-cutting rules

- Every prompt sent to Codex contains the no-GitHub-writes instruction; a test greps the built prompts for it.
- Fixtures are scrubbed of logins, emails and repository names before commit.
- Each milestone ends with lint, typecheck and tests green and a plain imperative commit.

## Spike findings

Filled in during M0.
