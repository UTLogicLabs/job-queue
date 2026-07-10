import type { Pool } from "pg";
import { mapJobRow, type JobRow } from "./mapJobRow.js";
import type { Job } from "./types.js";
import { DuplicateCompletionError, isUniqueViolation } from "./errors.js";

export async function completeJob(pool: Pool, jobId: string, workerId: string): Promise<Job> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const jobResult = await client.query<JobRow>(
      `update jobs
       set status = 'completed', completed_at = now()
       where id = $1 and locked_by = $2 and status = 'processing'
       returning *`,
      [jobId, workerId]
    );

    if (jobResult.rows.length === 0) {
      await client.query("rollback");
      throw new Error(
        `Cannot complete job ${jobId}: not currently processing under worker ${workerId}`
      );
    }

    try {
      await client.query(
        `insert into completions (job_id, worker_id) values ($1, $2)`,
        [jobId, workerId]
      );
    } catch (err) {
      if (isUniqueViolation(err, "completions_pkey")) {
        await client.query("rollback");
        throw new DuplicateCompletionError(jobId);
      }
      throw err;
    }

    await client.query("commit");
    return mapJobRow(jobResult.rows[0]);
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
