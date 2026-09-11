# Pull requests and issues share one `items` table

Supersedes [ADR 0004](0004-items-keyed-by-repository-kind-and-number.md), whose promise it turns out could not be kept.

ADR 0004 keyed every item-scoped table by `(repository, kind, number)` so that issues would "add a table and a prompt rather than a migration of every existing table", and rejected a single table because pull-request-only facts would leave half the columns null for issues. The keying was right; the conclusion was not. `assessments`, `notes`, `snoozes` and `review_drafts` each carry a foreign key into `pull_requests`, SQLite has no polymorphic foreign key, and a constraint can only be changed by rebuilding the table. A sibling `issues` table is therefore precisely the migration of every existing table that ADR 0004 set out to avoid, and it costs the `ON DELETE CASCADE` that makes `closed_retention_days` a single delete.

So `pull_requests` becomes `items`, its eight pull-request-only columns (`is_draft`, `head_sha`, `base_ref`, `additions`, `deletions`, `changed_files`, `checks`, `review_requested_from_user`) become nullable, and the columns issues bring of their own join them. One table is rebuilt; the four that reference it, and their cascade, are untouched.

## Considered options

- A sibling `issues` table with the foreign keys dropped: rejected because it rebuilds four tables instead of one and replaces database-enforced cascade with hand-written deletes.
- An `items` spine of `(repository, kind, number)` with `pull_requests` and `issues` as detail tables: the textbook answer, and right for a schema with several consumers. Rejected here because it rebuilds five tables and adds a sixth to keep a local SQLite file of a personal tool tidy, and because a join per read buys nothing the nullable columns cost.

## Consequences

Null now means "not applicable to this kind" as well as "not known", so a reader must go through the kind to know which. `selectOpen` and `selectAll` never filtered on `kind`; under one table they must, or the pull request list returns issues.
