# User notes are never sent to Codex

A note is free text the user attaches to a pull request. It is tempting to feed it to Codex as context on re-assessment, and an earlier draft of the design did exactly that. The user decided notes are private: they may hold opinions about people or plans that must never leave the machine or reach a model. Prior assessments are fed back to Codex; notes are not. A separate, explicitly agent-facing note, or a chat about an assessment, is the planned way to give Codex user context and is listed under future directions.

## Consequences

- Prompt builders must never read the notes table. A test guards this.
- The UI must not imply that a note influences the assessment.
