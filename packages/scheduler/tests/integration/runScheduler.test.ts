import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, createSchedule } from "@job-queue/core";
import { runScheduler, type SchedulerHandle } from "../../src/runScheduler.js";

async function truncateAll(pool: Pool) {
  await pool.query("truncate table completions, schedules, jobs restart identity cascade");
}

describe("runScheduler (integration)", () => {
  let pool: Pool;
  let handle: SchedulerHandle | undefined;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
  });

  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
    await pool.end();
  });

  it("enqueues a due schedule on its first tick", async () => {
    const schedule = await createSchedule(pool, "nightly-report", { n: 1 }, "*/5 * * * *");
    await pool.query("update schedules set next_run_at = now() - interval '1 second' where id = $1", [
      schedule.id,
    ]);

    handle = runScheduler(pool, { tickIntervalMs: 200 });

    const deadline = Date.now() + 3000;
    let jobCount = 0;
    while (Date.now() < deadline) {
      const result = await pool.query("select count(*)::int as count from jobs");
      jobCount = result.rows[0].count;
      if (jobCount > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(jobCount).toBe(1);
  });
});
