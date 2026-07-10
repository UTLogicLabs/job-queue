-- Up Migration

create table jobs (
  id            bigint generated always as identity primary key,
  type          text not null,
  queue         text not null default 'default',
  priority      int not null default 0,
  payload       jsonb not null,
  payload_hash  text generated always as (encode(sha256((type || payload::text)::bytea), 'hex')) stored,
  status        text not null default 'pending',
  attempts      int not null default 0,
  max_attempts  int not null default 5,
  run_at        timestamptz not null default now(),
  locked_by     text,
  locked_at     timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  constraint jobs_status_check check (status in ('pending', 'processing', 'completed', 'failed', 'dead')),
  constraint payload_size_guard check (pg_column_size(payload) < 262144)
);

create unique index jobs_dedupe_inflight
  on jobs (type, payload_hash)
  where status in ('pending', 'processing');

create index jobs_claimable
  on jobs (queue, priority desc, run_at)
  where status = 'pending';

create table schedules (
  id            bigint generated always as identity primary key,
  type          text not null,
  payload       jsonb not null,
  cron_expr     text not null,
  next_run_at   timestamptz not null,
  last_job_id   bigint references jobs(id)
);

create table completions (
  job_id       bigint primary key references jobs(id),
  worker_id    text not null,
  completed_at timestamptz not null default now()
);

-- Down Migration

drop table if exists completions;
drop table if exists schedules;
drop table if exists jobs;
