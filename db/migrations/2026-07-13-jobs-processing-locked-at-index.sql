-- Up Migration

create index jobs_processing_locked_at
  on jobs (locked_at)
  where status = 'processing';

-- Down Migration

drop index if exists jobs_processing_locked_at;
