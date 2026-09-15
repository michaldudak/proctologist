# GitHub read-only is enforced by instruction, not by tooling

Codex runs inside jobs with `gh` and `git` available and the user's `gh` token, which has `repo` scope and can comment, review, merge and push. The tool's contract is that nothing is ever written to GitHub. We considered a `gh` shim placed first on PATH that rejects mutating subcommands and non-GET `gh api` calls, plus git configuration that disables push from app-owned worktrees. The user chose to rely on prompt instructions alone for v1, accepting the risk in exchange for simplicity and for letting repository skills such as `base-ui-review` run unmodified.

## Consequences

- Every Codex prompt states explicitly that no GitHub write and no push may happen, and that flags such as `--comment` in repository skills must not be used.
- If a stray write ever occurs, the shim described above is the planned remedy and is listed under future directions in the design document.
- The app itself posts a review draft on the user's click, behind a confirmation (see the design document). That is the user's write through the app, not the agent's, and the rule above is untouched by it: the agent's prompts still forbid every write.
