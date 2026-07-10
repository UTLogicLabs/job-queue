import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db.js";
import { enqueue } from "../../src/enqueue.js";
import { claimJobs } from "../../src/claim.js";
import { truncateAll } from "./setup.js";

describe("claimJobs (integration)", () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("claims pending jobs, marking them processing and incrementing attempts", async () => {
    await enqueue(pool, "task", { n: 1 });

    const claimed = await claimJobs(pool, {
      queues: ["default"],
      batchSize: 10,
      workerId: "worker-1",
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].status).toBe("processing");
    expect(claimed[0].attempts).toBe(1);
    expect(claimed[0].lockedBy).toBe("worker-1");
  });

  it("only claims jobs from the requested queues", async () => {
    await enqueue(pool, "task", { n: 1 }, { queue: "emails" });
    await enqueue(pool, "task", { n: 2 }, { queue: "reports" });

    const claimed = await claimJobs(pool, {
      queues: ["emails"],
      batchSize: 10,
      workerId: "worker-1",
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].queue).toBe("emails");
  });

  it("does not claim jobs scheduled in the future", async () => {
    await enqueue(pool, "task", { n: 1 }, { runAt: new Date(Date.now() + 60_000) });

    const claimed = await claimJobs(pool, {
      queues: ["default"],
      batchSize: 10,
      workerId: "worker-1",
    });

    expect(claimed).toHaveLength(0);
  });

  it("orders by priority desc, then run_at, and respects batchSize", async () => {
    await enqueue(pool, "task", { n: "low" }, { priority: 0 });
    await enqueue(pool, "task", { n: "high" }, { priority: 10 });
    await enqueue(pool, "task", { n: "mid" }, { priority: 5 });

    const claimed = await claimJobs(pool, {
      queues: ["default"],
      batchSize: 2,
      workerId: "worker-1",
    });

    expect(claimed).toHaveLength(2);
    expect((claimed[0].payload as { n: string }).n).toBe("high");
    expect((claimed[1].payload as { n: string }).n).toBe("mid");
  });

  it("never lets two concurrent claimers take the same job (SKIP LOCKED)", async () => {
    for (let i = 0; i < 20; i++) {
      await enqueue(pool, "task", { n: i });
    }

    const [batchA, batchB] = await Promise.all([
      claimJobs(pool, { queues: ["default"], batchSize: 10, workerId: "worker-a" }),
      claimJobs(pool, { queues: ["default"], batchSize: 10, workerId: "worker-b" }),
    ]);

    expect(batchA).toHaveLength(10);
    expect(batchB).toHaveLength(10);

    const idsA = new Set(batchA.map((j) => j.id));
    const idsB = new Set(batchB.map((j) => j.id));
    const overlap = [...idsA].filter((id) => idsB.has(id));

    expect(overlap).toHaveLength(0);
  });
});
