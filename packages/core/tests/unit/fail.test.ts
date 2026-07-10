import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { failJob } from "../../src/fail.js";

function jobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "1",
    type: "task",
    queue: "default",
    priority: 0,
    payload: {},
    payload_hash: "abc",
    status: "processing",
    attempts: 1,
    max_attempts: 5,
    run_at: new Date(),
    locked_by: "worker-1",
    locked_at: new Date(),
    last_error: null,
    created_at: new Date(),
    completed_at: null,
    ...overrides,
  };
}

describe("failJob", () => {
  it("throws if the lock changes between the check and the update (TOCTOU)", async () => {
    // The initial SELECT sees the job still locked by worker-1 (matches), but by the time
    // the UPDATE runs — e.g. a reaper reclaimed it — the WHERE clause no longer matches,
    // so the UPDATE affects 0 rows. failJob must treat that as a failure, not silently
    // succeed with an empty result.
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [jobRow()] }) // initial SELECT
      .mockResolvedValueOnce({ rows: [] }); // UPDATE ... WHERE locked_by = $2 and status = $3
    const pool = { query } as unknown as Pool;

    await expect(failJob(pool, "1", "worker-1", "boom")).rejects.toThrow(
      /lock changed concurrently/
    );
  });
});
