# Codex works in app-owned worktrees backed by the user's clone

Codex needs a checkout to cross-check pull requests against the default branch and to draft reviews. Checking branches out in the user's clone would trample their work, and a separate mirror clone per repository means a multi-gigabyte first fetch for repositories like material-ui. We therefore create `git worktree`s under the app's cache directory using the user's configured clone as the object store: a persistent default-branch worktree refreshed on each Refresh, and ephemeral per-PR worktrees from `refs/pull/N/head` removed when the job ends. The user's clone is only ever fetched, never checked out, reset, or written to.

## Consequences

- The app depends on the user having a clone; repositories without one fall back to metadata-only assessments.
- `git worktree list` in the user's clone will show app-owned worktrees while a job runs; they are named with a `proctologist-` prefix and pruned on job end and app start.
