-- Up Migration

-- Payload stays well under Postgres's 8000-byte NOTIFY limit (a handful of short
-- fields) — do not add full job payload here.
create or replace function notify_job_event() returns trigger as $$
begin
  perform pg_notify(
    'job_events',
    json_build_object(
      'id', new.id::text,
      'type', new.type,
      'queue', new.queue,
      'status', new.status,
      'from', case when tg_op = 'UPDATE' then old.status else null end
    )::text
  );
  return new;
end;
$$ language plpgsql;

create trigger jobs_notify_event
  after insert or update of status on jobs
  for each row
  execute function notify_job_event();

-- Down Migration

drop trigger if exists jobs_notify_event on jobs;
drop function if exists notify_job_event();
