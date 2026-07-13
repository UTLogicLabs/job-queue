import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db.js";
import { createSchedule } from "../../src/createSchedule.js";
import { tickScheduler } from "../../src/tickScheduler.js";
import { truncateAll } from "./setup.js";

async function makeDue(pool: Pool, scheduleId: string) {
  await pool.query("update schedules set next_run_at = now() - interval '1 second' where id = $1", [
    scheduleId,
  ]);
}

describe("tickScheduler (integration)", () => {
  let pool: Pool;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
  });

  afterEach(async () => {
    await pool.end();
  });

  it("enqueues a due schedule with no prior job and advances next_run_at", async () => {
    const schedule = await createSchedule(pool, "nightly-report", { n: 1 }, "*/5 * * * *");
    await makeDue(pool, schedule.id);

    const result = await tickScheduler(pool);

    expect(result).toEqual({ enqueued: 1, skipped: 0 });

    const row = await pool.query("select next_run_at, last_job_id from schedules where id = $1", [
      schedule.id,
    ]);
    expect(row.rows[0].last_job_id).not.toBeNull();
    expect(new Date(row.rows[0].next_run_at).getTime()).toBeGreaterThan(Date.now());

    const jobs = await pool.query("select type, status from jobs where id = $1", [
      row.rows[0].last_job_id,
    ]);
    expect(jobs.rows[0]).toEqual({ type: "nightly-report", status: "pending" });
  });

  it("skips (and does not advance) a due schedule whose last job is still pending", async () => {
    const schedule = await createSchedule(pool, "nightly-report", { n: 1 }, "*/5 * * * *");
    await makeDue(pool, schedule.id);
    await tickScheduler(pool);

    await makeDue(pool, schedule.id);
    const before = await pool.query("select next_run_at, last_job_id from schedules where id = $1", [
      schedule.id,
    ]);

    const result = await tickScheduler(pool);

    expect(result).toEqual({ enqueued: 0, skipped: 1 });
    const after = await pool.query("select next_run_at, last_job_id from schedules where id = $1", [
      schedule.id,
    ]);
    expect(after.rows[0].last_job_id).toBe(before.rows[0].last_job_id);
    expect(new Date(after.rows[0].next_run_at).getTime()).toBe(
      new Date(before.rows[0].next_run_at).getTime()
    );

    const jobCount = await pool.query("select count(*)::int as count from jobs");
    expect(jobCount.rows[0].count).toBe(1);
  });

  it("enqueues again once the prior job has completed", async () => {
    const schedule = await createSchedule(pool, "nightly-report", { n: 1 }, "*/5 * * * *");
    await makeDue(pool, schedule.id);
    await tickScheduler(pool);

    const row = await pool.query("select last_job_id from schedules where id = $1", [schedule.id]);
    await pool.query("update jobs set status = 'completed' where id = $1", [
      row.rows[0].last_job_id,
    ]);
    await makeDue(pool, schedule.id);

    const result = await tickScheduler(pool);

    expect(result).toEqual({ enqueued: 1, skipped: 0 });
    const jobCount = await pool.query("select count(*)::int as count from jobs");
    expect(jobCount.rows[0].count).toBe(2);
  });

  it("leaves a schedule that is not yet due untouched", async () => {
    await createSchedule(pool, "nightly-report", { n: 1 }, "0 0 1 1 *"); // once a year

    const result = await tickScheduler(pool);

    expect(result).toEqual({ enqueued: 0, skipped: 0 });
  });

  it("never double-enqueues the same due schedule under concurrent ticks (SKIP LOCKED)", async () => {
    const schedule = await createSchedule(pool, "nightly-report", { n: 1 }, "*/5 * * * *");
    await makeDue(pool, schedule.id);

    const [a, b] = await Promise.all([tickScheduler(pool), tickScheduler(pool)]);
    const totalEnqueued = a.enqueued + b.enqueued;

    expect(totalEnqueued).toBe(1);

    const jobCount = await pool.query("select count(*)::int as count from jobs");
    expect(jobCount.rows[0].count).toBe(1);
  });
});
