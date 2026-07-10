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
docker-compose up -d postgres postgres_test

# apply migrations
npm run migrate       # dev database
npm run migrate:test  # test database

npm run dev           # workspace dev servers
npm test              # unit + integration tests
```

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
