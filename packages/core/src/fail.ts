import type { Pool } from "pg";
import { mapJobRow, type JobRow } from "./mapJobRow.js";
import type { Job } from "./types.js";
import { backoffMs, type BackoffOptions } from "./backoff.js";

export async function failJob(
  pool: Pool,
  jobId: string,
  workerId: string,
  errorMessage: string,
  backoffOptions: BackoffOptions = {}
): Promise<Job> {
  const current = await pool.query<JobRow>(
    `select * from jobs where id = $1 and locked_by = $2 and status = 'processing'`,
    [jobId, workerId]
  );
  if (current.rows.length === 0) {
    throw new Error(
      `Cannot fail job ${jobId}: not currently processing under worker ${workerId}`
    );
  }

  const job = current.rows[0];
  const willRetry = job.attempts < job.max_attempts;
  const delayMs = willRetry ? backoffMs(job.attempts, backoffOptions) : 0;

  const result = await pool.query<JobRow>(
    `update jobs
     set status = $4,
         run_at = case when $4 = 'pending' then now() + ($5 || ' milliseconds')::interval else run_at end,
         last_error = $6,
         locked_by = null,
         locked_at = null
     where id = $1 and locked_by = $2 and status = $3
     returning *`,
    [jobId, workerId, "processing", willRetry ? "pending" : "dead", delayMs, errorMessage]
  );

  if (result.rows.length === 0) {
    throw new Error(
      `Cannot fail job ${jobId}: lock changed concurrently (no longer processing under worker ${workerId})`
    );
  }

  return mapJobRow(result.rows[0]);
}
