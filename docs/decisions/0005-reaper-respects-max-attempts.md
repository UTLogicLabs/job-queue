# 0005. Reaper dead-letters jobs that have already exhausted attempts, instead of always requeuing

Status: Accepted
Date: 2026-07-11

## Context
`docs/ARCHITECTURE.md`'s reaper snippet, taken literally, always resets a stale `processing`
job back to `pending`:

```sql
update jobs set status = 'pending'
where status = 'processing' and locked_at < now() - interval '30 seconds'
```

`attempts` is incremented at claim time, not at explicit-failure time (`failJob`). So a job
whose worker keeps crashing before ever calling `failJob` (e.g. the process itself dies, not
just the job) accumulates `attempts` purely through repeated claim → crash → reclaim cycles,
and the reaper's literal snippet has no attempts check at all — it would happily requeue the
same job forever, past `max_attempts`, since nothing ever routes it to `dead`. `failJob`'s own
`attempts < max_attempts` check only fires when a worker is alive enough to call it; a reclaim
is exactly the case where the worker *isn't*.

## Decision
`reapStaleJobs()` checks `attempts >= max_attempts` when reclaiming a stale job: jobs still
under budget go back to `pending` (lock cleared, claimable again); jobs that have already hit
`max_attempts` go straight to `dead` instead, with a `last_error` noting the reclaim (only if
`last_error` isn't already set, so an explicit prior failure reason isn't clobbered).

## Consequences
- A job type whose handler reliably crashes the whole process (not just throws) still
  terminates at `max_attempts`, landing in the dead-letter queue for operator inspection
  instead of looping through reclaim cycles indefinitely.
- `max_attempts` now has one consistent meaning — "how many times this job may be attempted,
  full stop" — regardless of whether an attempt ends in an explicit `failJob` call or a
  reclaim. Two different code paths (`failJob`, `reapStaleJobs`) enforce the same budget.
- Rejected: implementing the architecture doc's snippet literally (always requeue on reclaim) —
  looks correct for a worker that occasionally misses a heartbeat under load, but has no
  terminating condition for a job type that crashes its worker outright every time.
