# 0003. Testing strategy & tooling (Vitest projects + docker-compose Postgres for integration)

Status: Accepted
Date: 2026-07-10

## Context
Some of this system is pure and testable without any infrastructure: backoff math, the dedupe
hash, cron-next-run calculation. The rest depends on real Postgres behavior that in-memory
fakes don't faithfully emulate — `FOR UPDATE SKIP LOCKED` claim semantics under concurrency,
partial unique indexes (dedupe-while-in-flight), generated columns, and `LISTEN`/`NOTIFY` for
the dashboard's realtime feed. None of that is meaningfully testable against `pg-mem`, and
`testcontainers` would add a Docker-in-Docker dependency on top of the docker-compose Postgres
already required for local dev and for the load-test story described in
`docs/ARCHITECTURE.md`.

## Decision
Vitest, configured as multiple projects in one root `vitest.config.ts`:
- `unit` — no DB, pure logic (`packages/*/tests/unit`).
- `integration` — real Postgres via docker-compose's `postgres_test` service
  (`packages/*/tests/integration`). Migrated fresh in a `beforeAll` hook, `TRUNCATE ...
  RESTART IDENTITY CASCADE` on all tables in `beforeEach`, and `fileParallelism: false` since
  integration test files share one truncated database.
- `dashboard` — Remix route/loader/action tests for `apps/dashboard`, jsdom environment where
  component rendering is involved.

The concurrency load test described in `docs/ARCHITECTURE.md` (`docker-compose --scale
worker=10`, 50k seeded jobs, kill-a-worker-mid-run) is deliberately **not** part of this Vitest
suite or CI — it's a separate, heavier script run on demand, since it needs real separate
worker processes racing each other, not a single test process.

Three corrections made during implementation (stage 2, core queue mechanics), found chasing
down what first looked like unrelated integration-test flakiness:
- **Root cause: `enqueue()` was stamping `run_at` from the application's clock instead of
  Postgres's.** The original implementation defaulted `runAt` to a JS `new Date()` and always
  passed it as the `run_at` value, overriding the column's own `default now()`. The claim query
  filters `run_at <= now()` using Postgres's clock. Measured skew between this host and the
  `postgres_test` container was small (sub-millisecond to ~17ms, direction varying) but non-zero
  — enough that a job enqueued and claimed back-to-back could occasionally get a `run_at`
  fractionally ahead of the DB's `now()` at claim time, making a freshly-inserted "immediate"
  job silently unclaimable for a few milliseconds. Symptoms were exactly the kind of
  can't-reproduce-in-isolation flakiness that burns hours: a job whose own `RETURNING *`
  confirmed it was inserted would still fail to be claimed moments later, with no stuck
  transaction visible in `pg_stat_activity` and no explanation from connection/pool state. Fix:
  `enqueue()` now passes `null` for `run_at` when the caller gives no explicit `runAt`, and the
  insert uses `coalesce($5, now())` — so "claim me immediately" jobs are timestamped by the same
  clock the claim query reads from, never the application's. Explicit future `runAt` values
  (real scheduling, not "now") still pass through unchanged, since minutes-scale schedules don't
  care about millisecond clock skew.
- **Pool lifecycle is per-test, not per-file**, and **`fileParallelism: false` passed on the
  CLI**, not just in each project's `test` block (`vitest run --project integration
  --no-file-parallelism` — Vitest 3's `test.projects` doesn't reliably propagate a config-only
  value). Both were adopted while still chasing the clock-skew bug above and turned out not to
  be its cause, but they're kept as standing practice regardless: a fresh `Pool` per test
  (`beforeEach`/`afterEach` instead of `beforeAll`/`afterAll`) is cheap at this test-suite size
  and removes an entire class of cross-test state leakage as a future suspect, and serializing
  integration files avoids them stepping on each other's rows in the one shared, truncated
  database.

## Consequences
- Real Postgres features (`SKIP LOCKED`, partial unique indexes, `LISTEN`/`NOTIFY`) are
  exercised faithfully — a test asserting no duplicate claims under concurrent transactions, or
  that the dedupe index actually rejects a second in-flight enqueue, would not be meaningful
  against a fake.
- One docker-compose file serves local dev, integration tests, and (later) the load test,
  avoiding a second DB-provisioning mechanism.
- CI stays fast: `unit` and `dashboard` projects need no services; `integration` needs one
  Postgres, provided as a GitHub Actions native `services:` container rather than spinning up
  docker-compose inside CI (unnecessary layer when only one DB is needed for CI, versus two for
  local dev's dev+test split).
- Rejected: `pg-mem` (doesn't implement `LISTEN`/`NOTIFY`, `SKIP LOCKED` concurrency, or partial
  indexes faithfully); `testcontainers` (slower cold start, redundant with the compose file
  already required for dev and the load test).
