# 0002. Migration tool: node-pg-migrate in SQL mode, dated filenames

Status: Accepted
Date: 2026-07-10

## Context
The schema is a handful of tables (`jobs`, `schedules`, `completions`) plus generated columns,
partial unique indexes, and (later) a trigger for `pg_notify`. All of it is raw SQL by project
ethos — there's no ORM anywhere in this stack (see `packages/core`'s db layer, hand-written
`pg` queries throughout). A migration tool is still needed for tracking which
migrations have run against a given database and for reversible up/down pairs.

This exact tradeoff was already worked through on the sibling `feature-flag-service` project
(same author, same "no ORM" stack shape) — its ADR settled on `node-pg-migrate` in SQL mode
after finding that the tool's actual SQL-mode convention is one file per migration with
`-- Up Migration` / `-- Down Migration` markers, not a `<name>.up.sql`/`<name>.down.sql` file
pair. Reusing that finding here rather than re-discovering it.

## Decision
Use `node-pg-migrate` with plain SQL migration files. Filenames are date-prefixed and
kebab-cased: `db/migrations/YYYY-MM-DD-title-kebab-case.sql`, each containing both directions
separated by `-- Up Migration` / `-- Down Migration` comment markers.

## Consequences
- One dependency gives a migrations-tracking table (`pgmigrations`) for free, applied
  consistently to both the dev and test databases (`npm run migrate` / `npm run migrate:test`).
- Files stay plain SQL, easy to read/diff, consistent with there being no ORM anywhere in the
  data layer.
- Filenames sort chronologically without a separate numeric sequence counter, at the cost of
  needing to remember to bump the date per new file.
- Rejected: hand-written numbered SQL + a custom runner (reinvents tracking logic for no
  benefit); node-pg-migrate's default JS wrapper mode (adds a JS indirection layer for what is
  otherwise 100% raw SQL); a `.up.sql`/`.down.sql` file-pair convention (not actually how this
  tool loads migrations in SQL mode).
