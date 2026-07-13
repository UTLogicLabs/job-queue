import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db.js";
import { enqueue } from "../../src/enqueue.js";
import { claimJobs } from "../../src/claim.js";
import { heartbeat } from "../../src/heartbeat.js";
import { truncateAll } from "./setup.js";

describe("heartbeat (integration)", () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("bumps locked_at for a job the worker still owns", async () => {
    await enqueue(pool, "task", { n: 1 });
    const [claimed] = await claimJobs(pool, {
      queues: ["default"],
      batchSize: 1,
      workerId: "worker-1",
    });

    const before = await pool.query("select locked_at from jobs where id = $1", [claimed.id]);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const ok = await heartbeat(pool, claimed.id, "worker-1");
    expect(ok).toBe(true);

    const after = await pool.query("select locked_at from jobs where id = $1", [claimed.id]);
    expect(new Date(after.rows[0].locked_at).getTime()).toBeGreaterThan(
      new Date(before.rows[0].locked_at).getTime()
    );
  });

  it("returns false and does nothing if another worker holds the lock", async () => {
    await enqueue(pool, "task", { n: 1 });
    const [claimed] = await claimJobs(pool, {
      queues: ["default"],
      batchSize: 1,
      workerId: "worker-1",
    });

    const ok = await heartbeat(pool, claimed.id, "worker-2");
    expect(ok).toBe(false);
  });

  it("returns false for a job that is no longer processing", async () => {
    const { job } = await enqueue(pool, "task", { n: 1 });

    const ok = await heartbeat(pool, job.id, "worker-1");
    expect(ok).toBe(false);
  });
});
