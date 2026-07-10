import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db.js";
import { enqueue } from "../../src/enqueue.js";
import { truncateAll } from "./setup.js";

describe("enqueue (integration)", () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("inserts a pending job", async () => {
    const { job, deduped } = await enqueue(pool, "send-welcome-email", { userId: 1 });

    expect(deduped).toBe(false);
    expect(job.status).toBe("pending");
    expect(job.queue).toBe("default");
    expect(job.attempts).toBe(0);
  });

  it("dedupes a second enqueue of the same type+payload while the first is still in flight", async () => {
    const first = await enqueue(pool, "send-welcome-email", { userId: 42 });
    const second = await enqueue(pool, "send-welcome-email", { userId: 42 });

    expect(second.deduped).toBe(true);
    expect(second.job.id).toBe(first.job.id);

    const count = await pool.query("select count(*)::int as count from jobs");
    expect(count.rows[0].count).toBe(1);
  });

  it("does not dedupe once the original job has completed", async () => {
    const first = await enqueue(pool, "send-welcome-email", { userId: 7 });
    await pool.query("update jobs set status = 'completed' where id = $1", [first.job.id]);

    const second = await enqueue(pool, "send-welcome-email", { userId: 7 });

    expect(second.deduped).toBe(false);
    expect(second.job.id).not.toBe(first.job.id);
  });

  it("respects queue, priority, and runAt overrides", async () => {
    const runAt = new Date(Date.now() + 60_000);
    const { job } = await enqueue(pool, "generate-report", { reportId: 1 }, {
      queue: "reports",
      priority: 10,
      runAt,
      maxAttempts: 3,
    });

    expect(job.queue).toBe("reports");
    expect(job.priority).toBe(10);
    expect(job.maxAttempts).toBe(3);
    expect(job.runAt.getTime()).toBe(runAt.getTime());
  });
});
