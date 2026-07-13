import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db.js";
import { enqueue } from "../../src/enqueue.js";
import { claimJobs } from "../../src/claim.js";
import { reapStaleJobs } from "../../src/reaper.js";
import { truncateAll } from "./setup.js";

async function backdateLock(pool: Pool, jobId: string, msAgo: number) {
  await pool.query("update jobs set locked_at = now() - ($2 || ' milliseconds')::interval where id = $1", [
    jobId,
    msAgo,
  ]);
}

describe("reapStaleJobs (integration)", () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("requeues a stale job that is still under its attempt budget", async () => {
    const { job } = await enqueue(pool, "task", { n: 1 }, { maxAttempts: 5 });
    await claimJobs(pool, { queues: ["default"], batchSize: 1, workerId: "worker-1" });
    await backdateLock(pool, job.id, 60_000);

    const result = await reapStaleJobs(pool, 30_000);

    expect(result).toEqual({ requeued: 1, dead: 0 });

    const row = await pool.query("select status, locked_by, locked_at, attempts from jobs where id = $1", [
      job.id,
    ]);
    expect(row.rows[0].status).toBe("pending");
    expect(row.rows[0].locked_by).toBeNull();
    expect(row.rows[0].locked_at).toBeNull();
    expect(row.rows[0].attempts).toBe(1);
  });

  it("dead-letters a stale job that has exhausted its attempt budget", async () => {
    const { job } = await enqueue(pool, "task", { n: 1 }, { maxAttempts: 1 });
    await claimJobs(pool, { queues: ["default"], batchSize: 1, workerId: "worker-1" });
    await backdateLock(pool, job.id, 60_000);

    const result = await reapStaleJobs(pool, 30_000);

    expect(result).toEqual({ requeued: 0, dead: 1 });

    const row = await pool.query("select status, locked_by, last_error from jobs where id = $1", [
      job.id,
    ]);
    expect(row.rows[0].status).toBe("dead");
    expect(row.rows[0].locked_by).toBeNull();
    expect(row.rows[0].last_error).toMatch(/reclaimed by reaper/);
  });

  it("does not preserve last_error clobbering — keeps an existing error if present", async () => {
    const { job } = await enqueue(pool, "task", { n: 1 }, { maxAttempts: 1 });
    await claimJobs(pool, { queues: ["default"], batchSize: 1, workerId: "worker-1" });
    await pool.query("update jobs set last_error = $2 where id = $1", [job.id, "prior real error"]);
    await backdateLock(pool, job.id, 60_000);

    await reapStaleJobs(pool, 30_000);

    const row = await pool.query("select last_error from jobs where id = $1", [job.id]);
    expect(row.rows[0].last_error).toBe("prior real error");
  });

  it("leaves a job with a fresh heartbeat untouched", async () => {
    const { job } = await enqueue(pool, "task", { n: 1 });
    await claimJobs(pool, { queues: ["default"], batchSize: 1, workerId: "worker-1" });

    const result = await reapStaleJobs(pool, 30_000);

    expect(result).toEqual({ requeued: 0, dead: 0 });

    const row = await pool.query("select status from jobs where id = $1", [job.id]);
    expect(row.rows[0].status).toBe("processing");
  });
});
