# PRoctologist

A personal macOS desktop app that audits the open pull requests of GitHub repositories you maintain. It fetches everything through the `gh` CLI, asks Codex (`codex exec`) to judge each pull request, and shows you what to merge, review, nudge, close, decide on, or leave alone.

Strictly read-only on GitHub. Runs locally with your own authenticated `gh` and `codex`.

- [Design](docs/DESIGN.md)
- [Glossary](CONTEXT.md)
- [Decision records](docs/adr/)

MIT licensed.
