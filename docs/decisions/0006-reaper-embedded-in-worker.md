# 0006. Reaper sweep runs embedded in every worker process, not as a separate service

Status: Accepted
Date: 2026-07-11

## Context
Something needs to run `reapStaleJobs()` on a periodic interval. `docs/ARCHITECTURE.md`
describes the sweep's SQL and cadence but doesn't mandate where it runs. The two options are a
dedicated reaper process/container (its own `docker-compose` service, its own lifecycle to
manage and keep alive) or folding the sweep into the worker processes that already exist.

## Decision
Every `packages/worker` process runs its own `reapStaleJobs` interval (every 10s, 30s
threshold — 3 missed 10s heartbeats, per the architecture doc's ratio) alongside its claim
loop. No separate reaper service.

This is safe because the sweep is a single idempotent, keyset-scoped bulk `UPDATE` — it only
ever touches rows matching `status = 'processing' and locked_at < now() - threshold`, which by
definition excludes any row a live worker is still heartbeating. Multiple workers running the
same sweep concurrently just means redundant `UPDATE`s that match zero additional rows after
the first one commits; there's no double-reclaim risk since the `WHERE` clause is
self-excluding once a row's `status` or `locked_at` changes.

## Consequences
- One fewer service to build, containerize, and keep alive — `docker-compose --scale worker=N`
  scales the reaper's sweep frequency along with worker count for free, which is harmless
  (redundant sweeps are nearly free — a single indexed `UPDATE` matching zero rows).
- No coordination needed between workers to decide "whose turn is it to sweep" — every worker
  just does it independently on its own timer.
- If workers ever scale to zero (e.g. all crashed), the reaper stops running too, and stale
  jobs stay `processing` until a worker comes back up. Acceptable here since the whole system
  is worker-driven — there's no processing happening at all with zero workers, so there's
  nothing being lost by the reaper also being paused.
- Rejected: a dedicated reaper service — clearer separation of concerns in the abstract, but
  more moving parts (its own container, its own crash/restart story) for no correctness
  benefit, since the sweep's idempotency already makes "who runs it" a non-issue.
