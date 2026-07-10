import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db.js";
import { enqueue } from "../../src/enqueue.js";
import { claimJobs } from "../../src/claim.js";
import { failJob } from "../../src/fail.js";
import { truncateAll } from "./setup.js";

describe("failJob (integration)", () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("schedules a retry with backoff when attempts remain", async () => {
    const { job } = await enqueue(pool, "task", { n: 1 }, { maxAttempts: 3 });
    const [claimed] = await claimJobs(pool, {
      queues: ["default"],
      batchSize: 1,
      workerId: "worker-1",
    });
    expect(claimed.attempts).toBe(1);

    const before = Date.now();
    const failed = await failJob(pool, job.id, "worker-1", "boom", {
      baseMs: 1000,
      random: () => 0,
    });

    expect(failed.status).toBe("pending");
    expect(failed.lastError).toBe("boom");
    expect(failed.lockedBy).toBeNull();
    // attempts=1 -> backoffMs(1) = 1000 * 2^1 = 2000ms
    expect(failed.runAt.getTime()).toBeGreaterThanOrEqual(before + 1900);
  });

  it("moves the job to dead once max attempts are exhausted", async () => {
    const { job } = await enqueue(pool, "task", { n: 1 }, { maxAttempts: 1 });
    await claimJobs(pool, { queues: ["default"], batchSize: 1, workerId: "worker-1" });

    const failed = await failJob(pool, job.id, "worker-1", "boom");

    expect(failed.status).toBe("dead");
    expect(failed.lastError).toBe("boom");
  });

  it("refuses to fail a job whose lock changed between the check and the update", async () => {
    const { job } = await enqueue(pool, "task", { n: 1 });
    await claimJobs(pool, { queues: ["default"], batchSize: 1, workerId: "worker-1" });

    // Simulate a reaper reclaiming this job (or another worker taking it over) in the
    // window between failJob's initial SELECT and its UPDATE.
    await pool.query("update jobs set locked_by = $2 where id = $1", [job.id, "worker-2"]);

    await expect(failJob(pool, job.id, "worker-1", "boom")).rejects.toThrow(
      /not currently processing/
    );

    const row = await pool.query("select locked_by, status, last_error from jobs where id = $1", [
      job.id,
    ]);
    expect(row.rows[0].locked_by).toBe("worker-2");
    expect(row.rows[0].status).toBe("processing");
    expect(row.rows[0].last_error).toBeNull();
  });
});
