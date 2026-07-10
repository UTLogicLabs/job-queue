import type { Pool } from "pg";

export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query("truncate table completions, schedules, jobs restart identity cascade");
}
