import type { Pool } from "pg";
import { mapJobRow, type JobRow } from "./mapJobRow.js";
import type { EnqueueOptions, EnqueueResult } from "./types.js";
import { isUniqueViolation } from "./errors.js";

export const MAX_PAYLOAD_BYTES = 256 * 1024;

const MAX_INSERT_ATTEMPTS = 3;

export async function enqueue(
  pool: Pool,
  type: string,
  payload: unknown,
  options: EnqueueOptions = {}
): Promise<EnqueueResult> {
  const payloadJson = JSON.stringify(payload);
  const size = Buffer.byteLength(payloadJson);
  if (size >= MAX_PAYLOAD_BYTES) {
    throw new Error(`Payload too large: ${size} bytes (max ${MAX_PAYLOAD_BYTES})`);
  }

  const queue = options.queue ?? "default";
  const priority = options.priority ?? 0;
  // Pass null (not `new Date()`) when the caller has no explicit runAt, so Postgres's own
  // `default now()` stamps the row using the same clock the claim query's `now()` reads from.
  // Stamping run_at from the application's clock instead would make an "immediate" job's
  // claimability depend on host/DB clock skew — however small — relative to `run_at <= now()`.
  const runAt = options.runAt ?? null;
  const maxAttempts = options.maxAttempts ?? 5;

  for (let attempt = 1; attempt <= MAX_INSERT_ATTEMPTS; attempt++) {
    try {
      const result = await pool.query<JobRow>(
        `insert into jobs (type, queue, priority, payload, run_at, max_attempts)
         values ($1, $2, $3, $4, coalesce($5, now()), $6)
         returning *`,
        [type, queue, priority, payloadJson, runAt, maxAttempts]
      );
      return { job: mapJobRow(result.rows[0]), deduped: false };
    } catch (err) {
      if (!isUniqueViolation(err, "jobs_dedupe_inflight")) {
        throw err;
      }
      const existing = await findInFlightDuplicate(pool, type, payloadJson);
      if (existing) {
        return { job: existing, deduped: true };
      }
      // The conflicting job transitioned out of pending/processing between our failed
      // insert and this lookup (dedupe is only while in flight) — retry the insert,
      // which should now succeed since the unique index no longer blocks it.
    }
  }

  throw new Error(
    `enqueue: gave up after ${MAX_INSERT_ATTEMPTS} attempts racing the in-flight dedupe index for type "${type}"`
  );
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
