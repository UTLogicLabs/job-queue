import type { Pool } from "pg";
import { computeNextRunAt } from "./cron.js";
import { mapScheduleRow, type ScheduleRow } from "./scheduleRow.js";
import type { Schedule } from "./types.js";

export async function createSchedule(
  pool: Pool,
  type: string,
  payload: unknown,
  cronExpr: string
): Promise<Schedule> {
  const nextRunAt = computeNextRunAt(cronExpr, new Date());

  const result = await pool.query<ScheduleRow>(
    `insert into schedules (type, payload, cron_expr, next_run_at)
     values ($1, $2, $3, $4)
     returning *`,
    [type, JSON.stringify(payload), cronExpr, nextRunAt]
  );

  return mapScheduleRow(result.rows[0]);
}
