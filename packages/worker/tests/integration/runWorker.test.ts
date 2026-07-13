import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool, enqueue } from "@job-queue/core";
import { createHandlerRegistry } from "../../src/registry.js";
import { runWorker, type WorkerHandle } from "../../src/runWorker.js";

async function truncateAll(pool: Pool) {
  await pool.query("truncate table completions, schedules, jobs restart identity cascade");
}

async function waitForStatus(
  pool: Pool,
  jobId: string,
  status: string,
  timeoutMs = 5000
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await pool.query("select status from jobs where id = $1", [jobId]);
    const current = result.rows[0]?.status;
    if (current === status || Date.now() > deadline) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("runWorker (integration)", () => {
  let pool: Pool;
  let handle: WorkerHandle | undefined;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
  });

  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
    await pool.end();
  });

  it("claims, runs the handler, and completes the job on success", async () => {
    const { job } = await enqueue(pool, "greet", { name: "ada" });
    const seen: unknown[] = [];
    const registry = createHandlerRegistry();
    registry.register("greet", async (payload) => {
      seen.push(payload);
    });

    handle = runWorker(pool, registry, {
      queues: ["default"],
      workerId: "worker-test",
      pollIntervalMs: 25,
    });

    const status = await waitForStatus(pool, job.id, "completed");
    expect(status).toBe("completed");
    expect(seen).toEqual([{ name: "ada" }]);

    const completions = await pool.query("select worker_id from completions where job_id = $1", [
      job.id,
    ]);
    expect(completions.rows[0].worker_id).toBe("worker-test");
  });

  it("routes a thrown handler error to dead once attempts are exhausted", async () => {
    const { job } = await enqueue(pool, "explode", { n: 1 }, { maxAttempts: 1 });
    const registry = createHandlerRegistry();
    registry.register("explode", async () => {
      throw new Error("handler blew up");
    });

    handle = runWorker(pool, registry, {
      queues: ["default"],
      workerId: "worker-test",
      pollIntervalMs: 25,
    });

    const status = await waitForStatus(pool, job.id, "dead");
    expect(status).toBe("dead");

    const row = await pool.query("select last_error from jobs where id = $1", [job.id]);
    expect(row.rows[0].last_error).toBe("handler blew up");
  });

  it("fails a job with no registered handler and lets it dead-letter", async () => {
    const { job } = await enqueue(pool, "unregistered-type", { n: 1 }, { maxAttempts: 1 });
    const registry = createHandlerRegistry();

    handle = runWorker(pool, registry, {
      queues: ["default"],
      workerId: "worker-test",
      pollIntervalMs: 25,
    });

    const status = await waitForStatus(pool, job.id, "dead");
    expect(status).toBe("dead");
  });
});
