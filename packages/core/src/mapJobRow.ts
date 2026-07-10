import type { Job } from "./types.js";

export type JobRow = {
  id: string;
  type: string;
  queue: string;
  priority: number;
  payload: unknown;
  payload_hash: string;
  status: string;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  locked_by: string | null;
  locked_at: Date | null;
  last_error: string | null;
  created_at: Date;
  completed_at: Date | null;
};

export function mapJobRow(row: JobRow): Job {
  return {
    id: row.id,
    type: row.type,
    queue: row.queue,
    priority: row.priority,
    payload: row.payload,
    payloadHash: row.payload_hash,
    status: row.status as Job["status"],
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    runAt: row.run_at,
    lockedBy: row.locked_by,
    lockedAt: row.locked_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}
