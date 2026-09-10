# Agents run under the user's own CLI login

The app spawns `codex` and `claude` as subprocesses and lets each CLI use whatever credentials it
already has. It never reads a token, never asks for an API key, and never holds an account of its
own; assessments are billed to whatever plan the user is signed in to. That is the simplest thing
that works, but because both vendors restrict automated access to their consumer plans, it is worth
recording why it is also the permitted thing.

Codex is the easy half. OpenAI documents
[`codex exec`](https://learn.chatgpt.com/docs/non-interactive-mode.md) for exactly this shape of
use — "run as part of a pipeline (CI, pre-merge checks, scheduled jobs)" — and documents every flag
this app passes: `--json`, `--output-schema`, `-o`, `--ephemeral`, and read-only as the default
sandbox. OpenAI also publishes a [Codex plugin for Claude Code](https://github.com/openai/codex-plugin-cc),
which is the same pattern again. Their terms of use do prohibit programmatically extracting Output,
so the sanction matters rather than being a formality, but the documentation supplies it.

Claude Code is the half that needed checking. Anthropic's
[Consumer Terms](https://www.anthropic.com/legal/consumer-terms) prohibit accessing the Services
"through automated or non-human means, whether through a bot, script, or otherwise" — except via an
API key, or "where we otherwise explicitly permit it". The exception is what saves us: the page
documenting `claude -p` is titled _Run Claude Code programmatically_ and covers scripts, CI and
unattended runs, and a plain `-p` run uses the subscription login by design. So a subscription is
permitted, but by an exception rather than by the absence of a rule, and the distinction is worth
keeping in mind: Anthropic's own recommended mode for scripted calls, `--bare`, deliberately
ignores the subscription login and wants `ANTHROPIC_API_KEY` instead. Their terms also reach further
than OpenAI's on competing use, covering products and services rather than only trained models. A
personal pull request triage tool is nowhere near that line, but the two sets of terms are not
interchangeable and should not be reasoned about as though they were.

We considered requiring an API key for both agents, which would sidestep the consumer-plan question
entirely. It was rejected because it would make the app cost money to run for users who already pay
for a plan that covers this, and because it would mean handling a secret — which the app is
otherwise built to never do.

## Consequences

- The user installs and signs in to each CLI themselves. The app's only credential-related job is to
  report clearly when a CLI is missing or signed out, rather than to fix it.
- `concurrency` defaults to 6 and allows up to 32, and `schedule` can run a full unattended refresh
  daily. Nothing in either set of terms forbids that, because consuming a rate limit is not
  circumventing one. It is still the usage shape most likely to draw throttling or account review,
  so the default stays modest and rate-limit errors are surfaced to the user rather than retried
  around. Automatic backoff-and-retry on a 429 is the one feature that would turn consumption into
  avoidance, and it is deliberately absent.
- If a user ever does want to run this hard enough to matter, the answer is an API key in the
  environment, which both CLIs already honour without the app doing anything.
- This records a reading of two documents that change without notice, checked on 2026-09-10, by
  someone who is not a lawyer. OpenAI's terms pages could not be retrieved directly at the time of
  writing, so the clause described above is second-hand; the Codex documentation is not.
