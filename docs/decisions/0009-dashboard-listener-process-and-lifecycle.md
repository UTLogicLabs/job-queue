# 0009. Dashboard listener: packaging, lifecycle, and aggregate reconciliation

Status: Accepted
Date: 2026-07-14

## Context

`docs/ARCHITECTURE.md`'s "Realtime / dashboard" section calls for a Postgres trigger →
`pg_notify` → single listener process → SSE fan-out to Remix clients, with in-memory
aggregates reconciled periodically against the database. Several details were left open:
where the listener code should live, how it starts in `react-router dev` vs. a real
deployment, whether queue-depth aggregates can be derived from events alone, and how the
`LISTEN` client should behave if it loses its connection.

## Decision

- **Location**: the listener, fan-out, and aggregates modules live in `apps/dashboard/server/`,
  not a separate workspace package. ADR 0001 already describes the dashboard as "the Remix app
  + SSE listener process" — one deployable unit, not an independently versioned package with no
  other consumer.
- **Dev/runtime start-up**: `getListener()` is a `globalThis`-guarded module-scope singleton,
  started lazily on first import (from the SSE route or the home loader). `react-router dev`
  runs a single Node process, so this is sufficient locally without a second OS process; it also
  survives Vite/HMR re-evaluating the module.
- **Trigger payload includes `from` (the pre-update status)**: `AFTER INSERT OR UPDATE OF status`
  only exposes `NEW` to callers by default; the trigger also emits `OLD.status` as `from` (`null`
  on insert) so the aggregates module can apply an accurate increment/decrement pair per event,
  keeping queue depth close to real-time between reconciliation ticks rather than stale for up to
  20s.
- **Reconciliation**: every 20s, `select queue, status, count(*) group by queue, status` wholesale
  replaces the in-memory queue-depth map — full replace, not a merge, since this query is ground
  truth. `reconcileNow()` is awaited once before `getListener()` resolves, so the first request
  ever served sees real numbers, not zeros. Throughput/failure-rate (trailing 60s windows) are
  **not** reconciled this way — there's no cheap query for "failures in the last 60s" against the
  current schema, so those are accepted as live-only, unrecoverable after a restart or missed
  window.
- **Reconnect policy**: on the `pg.Client`'s `error` event, log and retry after a fixed 2s delay,
  replacing only the `Client` — the `fanout`/`aggregates` instances (and any subscribed SSE
  streams) are left in place so a brief reconnect doesn't drop connected dashboard clients. No
  exponential backoff or circuit breaker.
- **bigint id as text**: the trigger casts `id::text` in `json_build_object`, matching the app's
  existing `Job.id: string` convention (`pg` already returns bigint columns as strings elsewhere)
  instead of transmitting `id` as a bare JSON number.

## Consequences

- Fan-out and aggregates are pure, DB-free modules and unit-test trivially; only the trigger
  itself and the `listener.ts` wiring need a real Postgres integration test.
- If the dashboard is ever horizontally scaled, each replica runs its own independent
  listener/fan-out/aggregates instance — harmless, since Postgres allows many `LISTEN` clients on
  the same channel, but each replica's in-memory state (and its SSE clients) stays local to that
  process. Not solved here; noted as a non-goal at this project's scale.
- A sustained database connection loss degrades to "log and retry every 2s" rather than a more
  resilient backoff/circuit-breaker — acceptable given a real deployment's container would
  typically restart anyway; a personal project doesn't need more than this.
- Rejected: a separate `packages/dashboard-listener` workspace — would need its own build/typecheck
  wiring and has no consumer besides `apps/dashboard`, for no isolation benefit given the two
  already share a deploy unit per ADR 0001.
- Docker packaging for running the listener alongside `react-router-serve` in one container is
  explicitly out of scope for this decision — no service in `docker-compose.yml` has any Docker
  packaging yet, so adding it just for the dashboard would be new scope, not a continuation of
  this stage's work.
