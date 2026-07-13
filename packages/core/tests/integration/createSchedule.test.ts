import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db.js";
import { createSchedule } from "../../src/createSchedule.js";
import { truncateAll } from "./setup.js";

describe("createSchedule (integration)", () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("inserts a schedule with next_run_at computed from the cron expression", async () => {
    const before = new Date();
    const schedule = await createSchedule(pool, "nightly-report", { n: 1 }, "*/5 * * * *");

    expect(schedule.type).toBe("nightly-report");
    expect(schedule.cronExpr).toBe("*/5 * * * *");
    expect(schedule.lastJobId).toBeNull();
    expect(schedule.nextRunAt.getTime()).toBeGreaterThan(before.getTime());
    expect(schedule.nextRunAt.getTime() - before.getTime()).toBeLessThanOrEqual(5 * 60_000);
  });

  it("rejects an invalid cron expression before touching the database", async () => {
    await expect(createSchedule(pool, "task", {}, "garbage")).rejects.toThrow();

    const count = await pool.query("select count(*)::int as count from schedules");
    expect(count.rows[0].count).toBe(0);
  });
});
