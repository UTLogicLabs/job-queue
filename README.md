# job-queue

A Sidekiq/BullMQ-style background job system built directly on Postgres — no Redis. Uses
`SELECT ... FOR UPDATE SKIP LOCKED` for claiming, `LISTEN/NOTIFY` for realtime dashboard
updates, heartbeat-based crash recovery, exponential backoff retries, a dead-letter queue,
cron-style scheduled jobs, and a Remix dashboard.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design and
[`docs/decisions/`](docs/decisions/) for the reasoning behind specific choices.

## Stack

- Node (plain worker/scheduler processes, no framework)
- Postgres — both queue storage and pub/sub (`LISTEN`/`NOTIFY`)
- Remix dashboard
- TypeScript throughout, npm workspaces
- Vitest (unit + integration against a real Postgres), `node-pg-migrate` for schema migrations

## Quickstart

```bash
npm install

# start dev + test Postgres instances
docker compose up -d postgres postgres_test

# apply migrations
npm run migrate       # dev database
npm run migrate:test  # test database

npm run dev           # workspace dev servers
npm test              # unit + integration tests
```

## Load test

Proves exactly-once processing under concurrent, horizontally-scaled workers (per
`docs/ARCHITECTURE.md`'s "Load test" section):

```bash
docker compose up -d postgres
npm run migrate
docker compose up -d --build --scale worker=10 worker scheduler

npm run load-test     # seeds 50k jobs, hard-kills a worker mid-run, asserts exactly-once completion
```

`scripts/load-test.ts` truncates and seeds `JOB_COUNT` (default 50,000) jobs, polls until they're
all processed, hard-kills one running `worker` container partway through to exercise the reaper's
crash recovery, and fails loudly if any job doesn't complete exactly once. Set `SKIP_KILL=1` to
run it as a plain throughput check without the crash-recovery step.

## Project layout

```
packages/core/       shared db pool, job/enqueue types, SQL helpers
packages/worker/      claim-loop worker process
packages/scheduler/   cron-style recurring job scheduler
apps/dashboard/       Remix dashboard (queue depth, throughput, failure rate, SSE realtime)
db/migrations/        node-pg-migrate SQL migrations
docs/                 architecture + ADRs
```

## Status

Under active development, built in staged PRs — see `docs/decisions/` for what's landed so far.
