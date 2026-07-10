import type { Pool } from "pg";
import { mapJobRow, type JobRow } from "./mapJobRow.js";
import type { EnqueueOptions, EnqueueResult } from "./types.js";
import { isUniqueViolation } from "./errors.js";

export const MAX_PAYLOAD_BYTES = 256 * 1024;

export async function enqueue(
  pool: Pool,
  type: string,
  payload: unknown,
  options: EnqueueOptions = {}
): Promise<EnqueueResult> {
  const payloadJson = JSON.stringify(payload);
  const size = Buffer.byteLength(payloadJson);
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload too large: ${size} bytes (max ${MAX_PAYLOAD_BYTES})`);
  }

  const queue = options.queue ?? "default";
  const priority = options.priority ?? 0;
  const runAt = options.runAt ?? new Date();
  const maxAttempts = options.maxAttempts ?? 5;

  try {
    const result = await pool.query<JobRow>(
      `insert into jobs (type, queue, priority, payload, run_at, max_attempts)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [type, queue, priority, payloadJson, runAt, maxAttempts]
    );
    return { job: mapJobRow(result.rows[0]), deduped: false };
  } catch (err) {
    if (isUniqueViolation(err, "jobs_dedupe_inflight")) {
      const existing = await findInFlightDuplicate(pool, type, payloadJson);
      if (existing) {
        return { job: existing, deduped: true };
      }
    }
    throw err;
  }
}

async function findInFlightDuplicate(pool: Pool, type: string, payloadJson: string) {
  const hashResult = await pool.query<{ hash: string }>(
    `select encode(sha256(($1 || $2::jsonb::text)::bytea), 'hex') as hash`,
    [type, payloadJson]
  );
  const hash = hashResult.rows[0].hash;

  const result = await pool.query<JobRow>(
    `select * from jobs
     where type = $1 and payload_hash = $2 and status in ('pending', 'processing')
     order by created_at desc
     limit 1`,
    [type, hash]
  );
  return result.rows[0] ? mapJobRow(result.rows[0]) : null;
}
