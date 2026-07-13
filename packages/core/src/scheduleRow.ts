import type { Schedule } from "./types.js";

export type ScheduleRow = {
  id: string;
  type: string;
  payload: unknown;
  cron_expr: string;
  next_run_at: Date;
  last_job_id: string | null;
};

export function mapScheduleRow(row: ScheduleRow): Schedule {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    cronExpr: row.cron_expr,
    nextRunAt: row.next_run_at,
    lastJobId: row.last_job_id,
  };
}
