# 0004. enqueue() resolves dedupe conflicts by returning the existing in-flight job

Status: Accepted
Date: 2026-07-10

## Context
`docs/ARCHITECTURE.md` establishes `jobs_dedupe_inflight`, a partial unique index on
`(type, payload_hash) where status in ('pending', 'processing')`, to prevent the same logical
job from being enqueued twice while one is already in flight. What it doesn't specify is what
`enqueue()` should actually *do* when that index rejects an insert — the two options are
"throw and make the caller deal with it" or "treat it as an idempotent no-op and hand back the
job that's already queued."

Since the whole point of the dedupe index is "don't double-enqueue this side effect," a caller
that gets an exception on a legitimate duplicate enqueue attempt would almost always want the
same thing: a reference to the job that's already going to run. Forcing every call site to
catch a Postgres unique-violation error to get that is unnecessary ceremony.

## Decision
`enqueue()` returns `{ job, deduped: boolean }` rather than just a `Job`. On a unique-violation
against `jobs_dedupe_inflight`, it re-derives the payload hash via a scalar query using the
same `encode(sha256((type || payload::text)::bytea), 'hex')` expression as the generated
column (rather than recomputing the hash in JS, where `JSON.stringify` output could disagree
with Postgres's `jsonb::text` canonicalization), looks up the existing in-flight job by that
hash, and returns it with `deduped: true`. Any other insert failure (payload too large, wrong
column type, connection error, etc.) still throws normally.

## Consequences
- Callers that don't care about dedupe can ignore `deduped` and just use `job` — enqueueing a
  duplicate is not an error from their perspective, it's "your job is already queued."
- Callers that do care (e.g. surfacing "this was already requested" to a user) can branch on
  `deduped` without needing to know Postgres error codes or constraint names.
- Recomputing the hash via SQL instead of JS guarantees the lookup matches whatever Postgres
  actually stored, even if `JSON.stringify` and `jsonb`'s canonical text form ever diverge
  (key order, whitespace, number formatting).
- Rejected: throwing a dedicated `DuplicateEnqueueError` on conflict — would force a try/catch
  at every call site for what is, functionally, the common case the dedupe index exists to
  handle gracefully, not an exceptional one.
