import type { Pool } from "pg";
import { mapJobRow, type JobRow } from "./mapJobRow.js";
import type { Job } from "./types.js";

export async function requeueDeadJob(pool: Pool, jobId: string): Promise<Job> {
  const result = await pool.query<JobRow>(
    `update jobs
     set status = 'pending',
         attempts = 0,
         run_at = now(),
         last_error = null,
         locked_by = null,
         locked_at = null
     where id = $1 and status = 'dead'
     returning *`,
    [jobId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Cannot requeue job ${jobId}: not currently dead`);
  }

  return mapJobRow(result.rows[0]);
}
