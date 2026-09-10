# PRoctologist

A personal macOS desktop app that audits the open pull requests of GitHub repositories you maintain.
It fetches everything through the `gh` CLI, asks a coding agent — Codex or Claude Code — to judge
each pull request, and shows you what to merge, review, nudge, close, decide on, or leave alone.

Strictly read-only on GitHub. Runs locally, driving whichever agent's CLI you already have signed
in.

## What you need

- macOS.
- [Node](https://nodejs.org) 26 (the version in `.nvmrc`) and [pnpm](https://pnpm.io) 12.
- The [GitHub CLI](https://cli.github.com), authenticated: `gh auth status` should name your account.
- At least one coding agent, signed in: the [Codex CLI](https://developers.openai.com/codex/cli) or
  [Claude Code](https://claude.com/claude-code). You can point different jobs at different agents
  ([ADR 0006](docs/adr/0006-one-runner-one-dialect-per-agent.md)).
  Assessments cost whatever that agent's plan charges; a quick assessment of one pull request is
  roughly 60 to 85 thousand input tokens.
- A local clone of each repository you track. Optional, but without one the agent cannot read the
  code, and relevance judgments get much weaker.

## Building it

```bash
pnpm install
pnpm dist
```

That leaves `apps/desktop/release/mac-arm64/PRoctologist.app`. Drag it to Applications. It is
unsigned, so the first launch needs a right-click and **Open**, or **Open Anyway** in System
Settings → Privacy & Security.

Closing the window leaves the app running, as a Mac app does; click its Dock icon to bring the window
back, and Quit to stop it.

To put that build in Applications without dragging it:

```bash
pnpm install:app
```

It packages the app the way `pnpm dist` does, then copies it over `/Applications/PRoctologist.app`
and clears the quarantine flag, so Spotlight finds the new version and Gatekeeper lets it start.
Packaging is part of it on purpose: `pnpm build` and `pnpm preview` only refresh `out/`, and a
`.app` is only rebuilt from `out/` by `electron-builder`, so installing without packaging would put
an older version in Applications than `pnpm preview` runs. Building on its own never touches
Applications. Pass a different directory as an argument to install somewhere else.

## First run

With nothing tracked yet, the app opens its settings dialog. Add a repository as `owner/name`,
point it at your local clone, and it will tell you which remote it will fetch from. Then press
**Refresh** to fetch the open pull requests, then **Assess N due** to have the agent judge them.
The first time that is every open pull request, so it takes a while; afterwards only the ones that
changed, or whose assessment is outdated, are due. The app fetches again in the
background every hour, and assesses nothing until you ask.

## The window

The table is sorted by what to do next: merges first, then reviews, then your own work, then closes,
nudges, decisions and waits. Quick wins — little work, and the work is yours to do — come first
within each group.

- The filter menus show, beside each option, how many rows you would be left with, not how many exist.
- Arrow keys or `j`/`k` move down the table, `Enter` opens the pull request on GitHub.
- The side panel holds the reasons behind each verdict, what the agent checked, the facts from GitHub,
  the assessment history, your private note, and the actions.

Markers beside a title: **You** opened it, **R** review requested from you, **D** draft, **B** a bot
opened it, **N** you left a note, **●** a verdict changed since the previous assessment, **Z**
snoozed.

## Configuration

`~/.config/proctologist/config.toml`, or `$XDG_CONFIG_HOME/proctologist/config.toml`. The settings
screen edits this file, and the app watches it, so hand edits take effect straight away.

```toml
# Fetch every tracked repository's pull requests in the background, this often. Never assesses.
schedule = { enabled = true, interval_minutes = 60 }

# Agent processes running at once, across every job.
concurrency = 6

# An assessment older than this is re-run even when nothing about the pull request changed.
outdated_after_days = 14

# Closed pull requests are kept this long, unless you left a note on them.
closed_retention_days = 30

# Diffs larger than this are left out of the bundle; the file list stands in for them.
diff_cutoff_kb = 60

# Assessing more than this many pull requests at once asks which of them you want rather than
# spending on all of them. 0 never asks.
confirm_assessments_above = 50

# Optional: put the database somewhere other than Application Support.
# data_dir = "~/proctologist"

# One profile per kind of job. `agent` is "codex" or "claude"; `model` and `effort` are optional
# everywhere and, left out, the agent picks its own. Both lists come from the installed agents,
# so the settings dialog lists whatever they actually accept. For Claude an alias such as "sonnet"
# tracks the current model, where "claude-sonnet-5" pins one.
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
review_instructions = "Free text used as the review draft prompt, e.g. use a repo skill."

# Optional per-repository overrides of any profile key, including which agent runs it.
[repositories.profiles.assess]
timeout_minutes = 5
```

## Command line

The CLI is for debugging and for scripting a refresh or an assessment outside the app. It shares the database and the
per-repository refresh lock, so the app and the CLI cannot both refresh one repository at once, and
either can stop the other's job.

```bash
proctologist refresh <owner/name>            # fetch the open pull requests; assesses nothing
proctologist refresh --all                   # every tracked repository, in turn
proctologist assess <owner/name> [--full]    # assess what is due, or everything with --full
proctologist assess <owner/name> <number> [--thorough]
proctologist review <owner/name> <number> [--effort <level>]
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

The agent is a different matter. It runs with `gh` and `git` available, because reading issues,
commits and history is most of what makes an assessment worth having. The read-only rule is carried by the
prompt: every prompt the app sends contains an instruction never to comment, review, approve, merge,
close, label, edit, push, or run any `gh` command that writes, and a test checks that the instruction
is still in every prompt the app builds
([ADR 0003](docs/adr/0003-read-only-github-by-instruction.md)).

That is an instruction, not a sandbox. The agent could ignore it. A quick assessment runs read-only,
which stops writes to disk but not network calls; thorough assessments and review drafts let the
agent write inside its own worktree so it can build and test. Codex gets this from its `read-only`
and `workspace-write` sandboxes; Claude Code has no sandbox flag, so a read-only run is one with its
file-editing tools taken away. If that trade is not one you want to make, do not point this at a
repository where a stray comment would matter.

Review drafts are never posted. They are written to the database for you to read, edit and post
yourself.

Your notes are private. They are stored locally, never sent to any agent, and never sent anywhere else
([ADR 0005](docs/adr/0005-user-notes-are-private-to-the-user.md)).

## Where it keeps things

| What                  | Where                                                    |
| --------------------- | -------------------------------------------------------- |
| Config                | `~/.config/proctologist/config.toml`                     |
| Database              | `~/Library/Application Support/PRoctologist/data.sqlite` |
| Worktrees, agent logs | `~/Library/Caches/PRoctologist/`                         |

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
`gh`, `codex` and `claude` executables over recorded fixtures; the one test that talks to the real
ones is behind a flag:

```bash
PROCTOLOGIST_LIVE=1 PROCTOLOGIST_LIVE_REPO=owner/name \
  PROCTOLOGIST_LIVE_CLONE=/path/to/clone pnpm test
```

- [Design](docs/DESIGN.md)
- [Implementation plan](docs/PLAN.md)
- [Glossary](CONTEXT.md)
- [Decision records](docs/adr/)

MIT licensed.
