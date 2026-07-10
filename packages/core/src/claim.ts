import type { Pool } from "pg";
import { mapJobRow, type JobRow } from "./mapJobRow.js";
import type { Job } from "./types.js";

export type ClaimOptions = {
  queues: string[];
  batchSize: number;
  workerId: string;
};

export async function claimJobs(pool: Pool, options: ClaimOptions): Promise<Job[]> {
  const { queues, batchSize, workerId } = options;

  const result = await pool.query<JobRow>(
    `with claimed as (
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
     returning jobs.*`,
    [queues, batchSize, workerId]
  );

  // UPDATE ... FROM ... RETURNING does not guarantee the CTE's ORDER BY is preserved in the
  // output, so re-sort here to uphold the priority-desc, run_at-asc contract for callers.
  return result.rows
    .map(mapJobRow)
    .sort((a, b) => b.priority - a.priority || a.runAt.getTime() - b.runAt.getTime());
}
