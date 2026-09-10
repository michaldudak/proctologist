# One runner, one dialect per agent

Codex was the only agent the app could drive, and the `codex` module knew that: the spawn loop, the log file, the timeout, the abort and the `codex exec` argument list were one piece of code. Claude Code does the same job through a different command line — `claude --print --output-format stream-json`, a schema passed inline rather than as a file, effort as a flag rather than a `-c` override, and its last message streamed as a `result` message rather than written to a file.

We considered a second runner beside the first, and an adapter that translated Claude's output into Codex's event shape. Both put the duplication in the wrong place: what actually differs between the two agents is small and declarative, while what they share — process groups, timeouts, aborts, log files, reading and validating the final message — is the part with the bugs in it. So there is one runner, and an `AgentDialect` per agent holding only the argument list and a reader over that agent's event stream. Which agent a run reaches for is decided by its **profile**, not by the caller, so nothing above the runner knows there is more than one.

Profiles carry the agent rather than there being one global choice, because the jobs differ: a quick assessment runs a few hundred times a week and wants whatever is cheapest, while a review draft runs once and wants the best reasoning available. Making the agent a per-profile setting costs one field and buys that.

## Consequences

- Adding a third agent means adding a dialect and a catalog reader, not touching the pipeline.
- Neither agent's sandbox is trusted to enforce the GitHub read-only rule; that stays with the prompt ([ADR 0003](0003-read-only-github-by-instruction.md)). Codex has `read-only` and `workspace-write` sandboxes; Claude Code has no sandbox flag, so a read-only run is one with its file-editing tools disallowed. The two are close but not identical, and the difference is documented rather than papered over.
- Assessments and review drafts record which agent made them. Rows written before this change say nothing, and the UI has to cope with that.
- Effort levels and models are read from the installed agent — `codex debug models`, `claude --help` — because they change with every release. Claude Code has no way to list its models, so that field stays free text rather than a menu the app would have to keep up to date.
