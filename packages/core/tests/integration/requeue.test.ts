import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db.js";
import { enqueue } from "../../src/enqueue.js";
import { claimJobs } from "../../src/claim.js";
import { failJob } from "../../src/fail.js";
import { requeueDeadJob } from "../../src/requeue.js";
import { truncateAll } from "./setup.js";

describe("requeueDeadJob (integration)", () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("resets a dead job back to pending with a fresh attempt budget", async () => {
    const { job } = await enqueue(pool, "task", { n: 1 }, { maxAttempts: 1 });
    await claimJobs(pool, { queues: ["default"], batchSize: 1, workerId: "worker-1" });
    await failJob(pool, job.id, "worker-1", "boom");

    const before = await pool.query("select status from jobs where id = $1", [job.id]);
    expect(before.rows[0].status).toBe("dead");

    const requeued = await requeueDeadJob(pool, job.id);

    expect(requeued.status).toBe("pending");
    expect(requeued.attempts).toBe(0);
    expect(requeued.lastError).toBeNull();
    expect(requeued.lockedBy).toBeNull();

    const claimedAgain = await claimJobs(pool, {
      queues: ["default"],
      batchSize: 1,
      workerId: "worker-2",
    });
    expect(claimedAgain).toHaveLength(1);
    expect(claimedAgain[0].id).toBe(job.id);
  });

  it("throws if the job is not currently dead", async () => {
    const { job } = await enqueue(pool, "task", { n: 1 });

    await expect(requeueDeadJob(pool, job.id)).rejects.toThrow(/not currently dead/);
  });
});
