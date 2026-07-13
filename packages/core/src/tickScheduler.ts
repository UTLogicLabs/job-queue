import type { Pool } from "pg";
import { enqueue } from "./enqueue.js";
import { computeNextRunAt } from "./cron.js";
import { mapScheduleRow, type ScheduleRow } from "./scheduleRow.js";

export type TickResult = {
  enqueued: number;
  skipped: number;
};

const RUNNING_STATUSES = new Set(["pending", "processing"]);

export async function tickScheduler(pool: Pool, limit = 100): Promise<TickResult> {
  const client = await pool.connect();
  let enqueued = 0;
  let skipped = 0;

  try {
    await client.query("begin");

    // FOR UPDATE SKIP LOCKED so multiple scheduler processes never process the same due
    // schedule twice concurrently — same pattern as the worker claim loop.
    const due = await client.query<ScheduleRow>(
      `select * from schedules
       where next_run_at <= now()
       order by next_run_at
       limit $1
       for update skip locked`,
      [limit]
    );

    for (const row of due.rows) {
      const schedule = mapScheduleRow(row);

      let stillRunning = false;
      if (schedule.lastJobId) {
        const jobResult = await client.query<{ status: string }>(
          `select status from jobs where id = $1`,
          [schedule.lastJobId]
        );
        stillRunning =
          jobResult.rows.length > 0 && RUNNING_STATUSES.has(jobResult.rows[0].status);
      }

      if (stillRunning) {
        // No pile-up: leave next_run_at untouched so this schedule stays "due" and gets
        // re-checked on the next tick, rather than queuing a second concurrent run.
        skipped++;
        continue;
      }

      // Enqueue via the same client/transaction holding this schedule row's lock, so the
      // job insert and the schedule's own advance (below) commit or roll back together —
      // if the transaction fails to commit, the job insert is undone right along with it,
      // instead of leaving an orphaned job with no corresponding schedule advancement.
      const { job } = await enqueue(client, schedule.type, schedule.payload);
      const nextRunAt = computeNextRunAt(schedule.cronExpr, schedule.nextRunAt);

      await client.query(`update schedules set next_run_at = $2, last_job_id = $3 where id = $1`, [
        schedule.id,
        nextRunAt,
        job.id,
      ]);
      enqueued++;
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  return { enqueued, skipped };
}
