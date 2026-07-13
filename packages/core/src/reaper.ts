import type { Pool } from "pg";

export type ReapResult = {
  requeued: number;
  dead: number;
};

export async function reapStaleJobs(pool: Pool, thresholdMs: number): Promise<ReapResult> {
  const requeued = await pool.query(
    `update jobs
     set status = 'pending', locked_by = null, locked_at = null
     where status = 'processing'
       and locked_at < now() - ($1 || ' milliseconds')::interval
       and attempts < max_attempts`,
    [thresholdMs]
  );

  const dead = await pool.query(
    `update jobs
     set status = 'dead',
         locked_by = null,
         locked_at = null,
         last_error = coalesce(last_error, 'reclaimed by reaper: worker crashed with attempts exhausted')
     where status = 'processing'
       and locked_at < now() - ($1 || ' milliseconds')::interval
       and attempts >= max_attempts`,
    [thresholdMs]
  );

  return { requeued: requeued.rowCount ?? 0, dead: dead.rowCount ?? 0 };
}
