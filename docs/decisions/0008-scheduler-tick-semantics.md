# 0008. Scheduler tick: SKIP LOCKED claiming, skip-not-advance on pile-up, one-step catch-up

Status: Accepted
Date: 2026-07-13

## Context
`docs/ARCHITECTURE.md` specifies the shape of a scheduler tick — for each due `schedules` row,
skip enqueueing if the last job is still `pending`/`processing`, else enqueue and advance
`next_run_at` — but leaves three concurrency/edge-case questions unanswered:
1. What stops two scheduler replicas (or overlapping ticks) from processing the same due
   schedule at once?
2. When a tick skips enqueueing because the prior run is still active, does `next_run_at`
   advance anyway, or stay put?
3. If the scheduler was down for a while and a schedule has missed several occurrences, does
   catch-up fire all of them at once, jump straight to "next occurrence after now," or
   something else?

## Decision
1. **Concurrency**: `tickScheduler()` selects due rows with `for update skip locked` inside a
   transaction (same pattern as the worker's claim loop), so concurrent scheduler processes
   (or overlapping ticks in one process) never grab the same due schedule at once.
2. **Skip means skip, not advance**: if the prior job is still running, `next_run_at` is left
   untouched. The schedule stays "due" and gets re-checked (and re-skipped, harmlessly) on
   every subsequent tick until the prior job finishes, at which point the very next tick
   enqueues and advances normally. This is simpler than tracking a separate "pending advance"
   state and matches the "no pile-up" intent literally — nothing about a skip should change
   the schedule's position.
3. **Catch-up advances one cron step at a time**, computed from the schedule's own
   `next_run_at` (not from `now()`) — `computeNextRunAt(cronExpr, schedule.nextRunAt)`. If the
   scheduler was down long enough to miss several occurrences, each tick fires exactly one
   missed occurrence and advances by one step; since the new `next_run_at` is still `<= now()`,
   the row remains due and gets processed again on a later tick, catching up gradually rather
   than in a single burst. This avoids a thundering-herd of instantly-enqueued jobs after
   downtime while staying simple (no separate "skip ahead to now" branch).

## Consequences
- No separate coordination mechanism (advisory locks, leader election) is needed to run
  multiple scheduler replicas safely — `SKIP LOCKED` handles it the same way it already does
  for job claiming.
- A schedule whose handler reliably runs long (longer than the tick interval) will visibly
  "fall behind" its nominal cadence rather than piling up concurrent runs — the tradeoff the
  architecture doc explicitly asked for ("no pile-up").
- Catch-up after extended downtime takes multiple tick intervals to fully resolve (one missed
  occurrence per tick) rather than firing a burst — acceptable for this project's scale;
  would need a "skip to now" fast-path if schedules with many missed occurrences and cheap,
  idempotent handlers were a real use case here.
- Rejected: unconditionally advancing `next_run_at` even when skipping (would silently drop a
  missed occurrence rather than deferring it); computing catch-up next-run from `now()` instead
  of the schedule's own `next_run_at` (would cause more aggressive catch-up bursts and isn't
  needed at this project's scale).
