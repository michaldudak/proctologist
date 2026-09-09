# Assessments, notes, snoozes and jobs are keyed by repository, item kind and number

Only pull requests exist in v1, but issues are the planned next feature and reuse nearly the whole pipeline. Keying user-owned and Codex-owned data by `(repository, item_kind, item_number)` from day one means issues later add a table and a prompt rather than a migration of every existing table. The visible cost is a `kind` column that holds a single value for now; a reader should not remove it.

## Considered options

- One `items` table with a kind column and nullable PR-only columns: rejected because PR-only facts (head commit, diff stats, reviews, checks, mergeability) would leave half the columns null for issues.
- Build PR-only and refactor when issues arrive: rejected because the keying convention costs nothing now and everything later.
