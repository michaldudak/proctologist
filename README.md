# PRoctologist

A personal macOS desktop app that audits the open pull requests of GitHub repositories you maintain.
It fetches everything through the `gh` CLI, asks Codex (`codex exec`) to judge each pull request, and
shows you what to merge, review, nudge, close, decide on, or leave alone.

Strictly read-only on GitHub. Runs locally with your own authenticated `gh` and `codex`.

## What you need

- macOS.
- [Node](https://nodejs.org) 26 (the version in `.nvmrc`) and [pnpm](https://pnpm.io) 12.
- The [GitHub CLI](https://cli.github.com), authenticated: `gh auth status` should name your account.
- The [Codex CLI](https://developers.openai.com/codex/cli), signed in. Assessments cost whatever your
  Codex plan charges; a quick assessment of one pull request is roughly 60 to 85 thousand input
  tokens.
- A local clone of each repository you track. Optional, but without one Codex cannot read the code,
  and relevance judgments get much weaker.

## Building it

```bash
pnpm install
pnpm dist
```

That leaves `apps/desktop/release/mac-arm64/PRoctologist.app`. Drag it to Applications. It is
unsigned, so the first launch needs a right-click and **Open**, or **Open Anyway** in System
Settings → Privacy & Security.

## First run

PRoctologist lives in the menu bar; closing the window hides it rather than quitting.

With nothing tracked yet, the app opens on its settings screen. Add a repository as `owner/name`,
point it at your local clone, and it will tell you which remote it will fetch from. Then press
**Refresh**. The first refresh assesses every open pull request, so it takes a while; later ones only
re-assess what changed.

## The window

The table is sorted by what to do next: merges first, then reviews, then your own work, then closes,
nudges, decisions and waits. Quick wins — little work, and the work is yours to do — come first
within each group.

- The chips filter, and their counts say how many rows you would be left with, not how many exist.
- Arrow keys or `j`/`k` move down the table, `Enter` opens the pull request on GitHub.
- The side panel holds the reasons behind each verdict, what Codex checked, the facts from GitHub,
  the assessment history, your private note, and the actions.

Markers beside a title: **You** opened it, **R** review requested from you, **D** draft, **B** a bot
opened it, **N** you left a note, **●** a verdict changed since the previous assessment, **Z**
snoozed.

## Configuration

`~/.config/proctologist/config.toml`, or `$XDG_CONFIG_HOME/proctologist/config.toml`. The settings
screen edits this file, and the app watches it, so hand edits take effect straight away.

```toml
# Refresh every tracked repository once a day, at this time, in this machine's own time zone.
schedule = { enabled = false, time = "08:00" }

# Codex processes running at once, across every job.
concurrency = 6

# An assessment older than this is re-run even when nothing about the pull request changed.
outdated_after_days = 14

# Closed pull requests are kept this long, unless you left a note on them.
closed_retention_days = 30

# Diffs larger than this are left out of the bundle; the file list stands in for them.
diff_cutoff_kb = 60

# Optional: put the database somewhere other than Application Support.
# data_dir = "~/proctologist"

# `model` is optional everywhere; left out, Codex picks its own.
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
timeout_minutes = 5
```

## Command line

The CLI is for debugging and for scripting a refresh outside the app. It shares the database and the
per-repository refresh lock, so the app and the CLI cannot both refresh one repository at once, and
either can stop the other's job.

```bash
proctologist refresh <owner/name> [--full]   # fetch and assess what changed
proctologist refresh --all [--full]          # every tracked repository, in turn
proctologist assess <owner/name> <number> [--thorough]
proctologist review <owner/name> <number> [--effort minimal|low|medium|high]
proctologist jobs [--all]
proctologist abort <id>
proctologist repositories
```

Progress goes to stderr and results to stdout. It exits 0 on success, 1 on failure and 2 on a usage
mistake. Run it from the repository with `node packages/cli/dist/main.js …` after `pnpm typecheck`,
or link it with `pnpm --filter @proctologist/cli link --global`.

## How read-only is enforced, and where that stops

The app itself only ever reads from GitHub: every call it makes is a GraphQL query or a `GET`, and
there is no code in it that writes.

Codex is a different matter. It runs with `gh` and `git` available, because reading issues, commits
and history is most of what makes an assessment worth having. The read-only rule is carried by the
prompt: every prompt the app sends contains an instruction never to comment, review, approve, merge,
close, label, edit, push, or run any `gh` command that writes, and a test checks that the instruction
is still in every prompt the app builds
([ADR 0003](docs/adr/0003-read-only-github-by-instruction.md)).

That is an instruction, not a sandbox. Codex could ignore it. A quick assessment runs in the
`read-only` sandbox, which stops writes to disk but not network calls; thorough assessments and
review drafts run in `workspace-write` so Codex can build and test. If that trade is not one you want
to make, do not point this at a repository where a stray comment would matter.

Review drafts are never posted. They are written to the database for you to read, edit and post
yourself.

Your notes are private. They are stored locally, never sent to Codex, and never sent anywhere else
([ADR 0005](docs/adr/0005-user-notes-are-private-to-the-user.md)).

## Where it keeps things

| What                  | Where                                                    |
| --------------------- | -------------------------------------------------------- |
| Config                | `~/.config/proctologist/config.toml`                     |
| Database              | `~/Library/Application Support/PRoctologist/data.sqlite` |
| Worktrees, Codex logs | `~/Library/Caches/PRoctologist/`                         |

The cache is safe to delete at any time; worktrees are recreated on the next refresh and the logs are
only there for when something goes wrong. To remove the app entirely, delete all three, drag
`PRoctologist.app` to the bin, and turn off **Open PRoctologist when you log in** first if you turned
it on.

Worktrees live in the cache but use your clone as their object store, so they cost little disk and
your clone is never checked out to something else
([ADR 0001](docs/adr/0001-worktrees-off-the-users-clone.md)).

## Development

```bash
pnpm app        # the Electron app with hot reload
pnpm --filter @proctologist/desktop views   # just the renderer, in a browser, against fixtures
pnpm lint && pnpm typecheck && pnpm test
```

`packages/core` holds everything that is not Electron and is where the tests are. Tests drive fake
`gh` and `codex` executables over recorded fixtures; the one test that talks to the real ones is
behind a flag:

```bash
PROCTOLOGIST_LIVE=1 PROCTOLOGIST_LIVE_REPO=owner/name \
  PROCTOLOGIST_LIVE_CLONE=/path/to/clone pnpm test
```

- [Design](docs/DESIGN.md)
- [Implementation plan](docs/PLAN.md)
- [Glossary](CONTEXT.md)
- [Decision records](docs/adr/)

MIT licensed.
