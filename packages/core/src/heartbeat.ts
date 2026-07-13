import type { Pool } from "pg";

export async function heartbeat(pool: Pool, jobId: string, workerId: string): Promise<boolean> {
  const result = await pool.query(
    `update jobs set locked_at = now()
     where id = $1 and locked_by = $2 and status = 'processing'`,
    [jobId, workerId]
  );
  return (result.rowCount ?? 0) > 0;
}
