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

Two corrections made during implementation (stage 2, core queue mechanics):
- **Pool lifecycle is per-test, not per-file.** Integration test files originally created one
  `Pool` in `beforeAll` and reused it across every `it` in the file (mirroring the sibling
  `feature-flag-service` pattern). In practice this produced intermittent, unexplained
  claim/complete failures under this project's local Docker setup — a job enqueued and visible
  via its own `RETURNING *` would then fail to be claimed moments later, despite `pg_stat_activity`
  showing no stuck "idle in transaction" session and only one physical connection in use.
  Recreating the `Pool` in `beforeEach` and calling `pool.end()` in `afterEach` (one connection
  per test, not per file) made the flakiness disappear reliably across dozens of repeated runs.
  The exact mechanism wasn't conclusively isolated, but per-test pool isolation is cheap here
  (a handful of tests per file) and removes the class of bug entirely, so it's the standing
  pattern for every integration test file.
- **`fileParallelism: false` must be passed on the CLI, not just in each project's `test` block.**
  Vitest 3's `test.projects` array doesn't propagate a root-level `fileParallelism: false`, and
  even setting it inside the `integration` project's own block didn't reliably serialize files
  in practice — only `vitest run --project integration --no-file-parallelism` did. The
  `test:integration` script passes that flag explicitly rather than relying on config alone.

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
