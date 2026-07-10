import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db.js";
import { enqueue } from "../../src/enqueue.js";
import { claimJobs } from "../../src/claim.js";
import { completeJob } from "../../src/complete.js";
import { DuplicateCompletionError } from "../../src/errors.js";
import { truncateAll } from "./setup.js";

describe("completeJob (integration)", () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("marks a claimed job completed and records a completion", async () => {
    await enqueue(pool, "task", { n: 1 });
    const [claimed] = await claimJobs(pool, {
      queues: ["default"],
      batchSize: 1,
      workerId: "worker-1",
    });

    const completed = await completeJob(pool, claimed.id, "worker-1");

    expect(completed.status).toBe("completed");
    expect(completed.completedAt).not.toBeNull();

    const completions = await pool.query("select * from completions where job_id = $1", [
      claimed.id,
    ]);
    expect(completions.rows).toHaveLength(1);
    expect(completions.rows[0].worker_id).toBe("worker-1");
  });

  it("throws DuplicateCompletionError if the job was already completed by another worker", async () => {
    await enqueue(pool, "task", { n: 1 });
    const [claimed] = await claimJobs(pool, {
      queues: ["default"],
      batchSize: 1,
      workerId: "worker-1",
    });

    // Simulate a reaper reclaim + second worker racing to complete the same job:
    // both think they hold the lock, only one completions insert can win.
    await pool.query("update jobs set locked_by = $2 where id = $1", [claimed.id, "worker-2"]);
    await completeJob(pool, claimed.id, "worker-2");
    await pool.query(
      "update jobs set status = 'processing', locked_by = $2 where id = $1",
      [claimed.id, "worker-1"]
    );

    await expect(completeJob(pool, claimed.id, "worker-1")).rejects.toThrow(
      DuplicateCompletionError
    );
  });

  it("refuses to complete a job not locked by the given worker", async () => {
    await enqueue(pool, "task", { n: 1 });
    const [claimed] = await claimJobs(pool, {
      queues: ["default"],
      batchSize: 1,
      workerId: "worker-1",
    });

    await expect(completeJob(pool, claimed.id, "worker-2")).rejects.toThrow(/not currently processing/);
  });
});
