# Postgres-Backed Job Queue — Architecture

Sidekiq/BullMQ-style background job system on Postgres. No Redis. `SELECT ... FOR UPDATE SKIP LOCKED` for claiming, `LISTEN/NOTIFY` for realtime, Remix dashboard, plain Node worker processes, Docker Compose for horizontal scale.

## Decisions locked in
- **Dedupe**: hash of `type + canonicalized(payload)`, unique *while in flight* (partial index), not permanent.
- **Dashboard realtime**: Postgres trigger → `NOTIFY` → single listener process → SSE fan-out to Remix clients.
- **Load test / scale**: Docker Compose `--scale worker=N`.

## Schema

```sql
create table jobs (
  id            bigint generated always as identity primary key,
  type          text not null,
  queue         text not null default 'default',
  priority      int not null default 0, -- higher = more urgent
  payload       jsonb not null,
  payload_hash  text generated always as (encode(sha256((type || payload::text)::bytea), 'hex')) stored,
  status        text not null default 'pending', -- pending | processing | completed | failed | dead
  attempts      int not null default 0,
  max_attempts  int not null default 5,
  run_at        timestamptz not null default now(),
  locked_by     text,
  locked_at     timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  constraint payload_size_guard check (pg_column_size(payload) < 262144) -- backstop only, see payload size section
)

-- dedupe only while a job is actually queued/running
create unique index jobs_dedupe_inflight
  on jobs (type, payload_hash)
  where status in ('pending', 'processing')

-- claim query index — queue first (worker filters on it), then priority/run_at for ordering
create index jobs_claimable
  on jobs (queue, priority desc, run_at)
  where status = 'pending'

create table schedules (
  id            bigint generated always as identity primary key,
  type          text not null,
  payload       jsonb not null,
  cron_expr     text not null,
  next_run_at   timestamptz not null,
  last_job_id   bigint references jobs(id)
)

-- live proof of exactly-once processing (see load test section)
create table completions (
  job_id       bigint primary key references jobs(id),
  worker_id    text not null,
  completed_at timestamptz not null default now()
)
```

Dead jobs stay in `jobs` with `status = 'dead'` — no separate table. Simpler queries, one source of truth, filter by status.

## Claim loop (worker)

Worker is configured with which queues it services (`QUEUES=default,emails` env var) and a batch size (`BATCH_SIZE=10`, tune from load test data — start small, raise if single-row/small-batch claims cap throughput).

```sql
with claimed as (
  select id from jobs
  where status = 'pending' and run_at <= now() and queue = any($1)
  order by priority desc, run_at
  limit $2
  for update skip locked
)
update jobs
set status = 'processing', locked_by = $3, locked_at = now(), attempts = attempts + 1
from claimed
where jobs.id = claimed.id
returning jobs.*
```

- `$1` = queues this worker services, `$2` = batch size, `$3` = worker id.
- Batch is processed with bounded in-process concurrency (e.g. a simple async pool, concurrency ≤ batch size) — not one giant `Promise.all`, so one slow job doesn't stall an otherwise-idle worker slot.
- Each job in the batch heartbeats independently (see reaper section) — batch size doesn't change crash blast radius, since a crashed worker's jobs get reclaimed individually once their `locked_at` goes stale, regardless of how many were claimed together.
- On success: `status = 'completed'`, `completed_at = now()`, plus `INSERT INTO completions (job_id, worker_id)` in the same transaction — an insert conflict here means another worker already completed this job (see load test section).
- On failure: if `attempts < max_attempts`, `status = 'pending'`, `run_at = now() + backoff(attempts)`, store `last_error`. Else `status = 'dead'`.
- Backoff: `base * 2^attempts + jitter(0, base)`, cap at some max (e.g. 5 min).

## Crash recovery (reaper) — heartbeat/lease, not static timeout

A static "longest expected job runtime" timeout is a guess that's wrong in both directions: too short reclaims live jobs (double-processing), too long delays recovery of actually-dead ones. Instead, decouple liveness from job duration with a heartbeat, same pattern as SQS visibility timeout extension or Sidekiq's liveness ping.

- Worker runs a background interval (every 10s) while a job is `processing`:
  ```sql
  update jobs set locked_at = now()
  where id = $1 and locked_by = $2 and status = 'processing'
  ```
- Reaper sweeps every N seconds with a small, constant threshold — independent of job type or expected duration:
  ```sql
  update jobs set status = 'pending'
  where status = 'processing' and locked_at < now() - interval '30 seconds'
  ```
- 30s = 3 missed 10s beats. Tune ratio, not the base timeout, if you need to trade off reclaim latency vs. false-positive risk under GC pauses/network blips.
- Cost: one extra UPDATE per active job per heartbeat interval. Trivial at load-test scale (10 workers); would need batching if scaled to thousands of concurrent jobs — out of scope here.

The dedupe index and the reaper are solving different problems — dedupe protects *enqueue*, the reaper/heartbeat protects *processing* — don't conflate them.

## Realtime / dashboard

- Trigger on `jobs` (`AFTER INSERT OR UPDATE OF status`) → `pg_notify('job_events', json_build_object('id', id, 'type', type, 'status', status)::text)`.
- One long-lived Node process holds a single `pg` client in `LISTEN job_events` mode, fans out to an in-memory set of SSE connections.
- Remix resource route (`/dashboard/events`) opens an SSE stream, subscribes to the fan-out, closes on disconnect.
- Aggregates (queue depth, throughput/min, failure rate) are **not** derived purely from the event stream — maintain in-memory counters updated per event, but reconcile against a real `count(*) group by type, status` query every 10-30s to kill drift from missed events (network blip, restart).

## Scheduler (recurring jobs)

Separate process, ticks every 30-60s:
- For each `schedules` row where `next_run_at <= now()`: check if `last_job_id`'s job is still `pending`/`processing` — if so, skip (no pile-up), else enqueue and advance `next_run_at` via cron parser.

## Docker Compose layout

```yaml
services:
  postgres: ...
  worker:
    build: ./worker
    deploy: {} # or just rely on --scale
  scheduler: ...
  dashboard: ... # remix app + sse listener process
```

Load test: `docker-compose up --scale worker=10`, seed 50k jobs, assert `count(completed) == 50000`, kill a worker container mid-run, confirm reaper reclaims its jobs (heartbeat-based, so this should happen within ~30s regardless of what those jobs were doing).

**Proving no duplicate processing**: don't check for duplicate `payload_hash` after the fact — the dedupe index frees the hash on completion, so a post-run query proves nothing. Instead, insert into `completions (job_id primary key, worker_id, completed_at)` as part of each job's completion step. A unique-violation on that insert is a live, direct assertion failure: two workers completed the same `job_id`. This is the actual proof, caught during the run, not inferred afterward.

## Payload size guard

`pg_column_size` reflects on-disk/TOASTed size, not raw JSON size — it's a rough backstop (see the `payload_size_guard` check constraint in the schema), not something to rely on for a precise limit or a clean error message. Source of truth is an application-level check in `enqueue()`:

```ts
const MAX_PAYLOAD_BYTES = 256 * 1024

type EnqueueOptions = {
  queue?: string
  priority?: number
  runAt?: Date
}

function enqueue(type: string, payload: unknown, options: EnqueueOptions = {}) {
  const size = Buffer.byteLength(JSON.stringify(payload))
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload too large: ${size} bytes (max ${MAX_PAYLOAD_BYTES})`)
  }

  // insert with queue, priority, run_at ?? now()
}
```

This gives a clear, immediate error at the call site instead of surfacing as a DB constraint violation deep in an insert. The DB check constraint stays as defense-in-depth only — if the app-level guard is ever bypassed (direct SQL insert, migration script), you still don't get an unbounded row.

## Queues in practice

`type` identifies the handler (what code runs); `queue` identifies the lane (routing + resource isolation). Example: `type: 'send-welcome-email'` and `type: 'send-password-reset'` can both live on `queue: 'emails'`, serviced by a small dedicated worker pool, separate from a `queue: 'reports'` pool doing heavier, slower work — without needing separate codebases or job tables. `priority` orders within a queue (e.g. password-reset emails ahead of marketing emails on the same `emails` queue) but does not cross queue boundaries — a worker only ever pulls from the queues it's configured to service.