import type { Pool } from "pg";
import { claimJobs, completeJob, failJob, heartbeat, reapStaleJobs, type Job } from "@job-queue/core";
import type { HandlerRegistry } from "./registry.js";
import { runWithConcurrency } from "./pool.js";

export type RunWorkerOptions = {
  queues: string[];
  workerId: string;
  batchSize?: number;
  concurrency?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  reapIntervalMs?: number;
  reapThresholdMs?: number;
};

export type WorkerHandle = {
  stop: () => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function runWorker(
  pool: Pool,
  registry: HandlerRegistry,
  options: RunWorkerOptions
): WorkerHandle {
  const {
    queues,
    workerId,
    batchSize = 10,
    concurrency = batchSize,
    pollIntervalMs = 1000,
    heartbeatIntervalMs = 10_000,
    reapIntervalMs = 10_000,
    reapThresholdMs = 30_000,
  } = options;

  let stopped = false;

  async function processJob(job: Job): Promise<void> {
    const handler = registry.get(job.type);
    let lockLost = false;
    const hb = setInterval(() => {
      heartbeat(pool, job.id, workerId)
        .then((stillOwned) => {
          if (!stillOwned) lockLost = true;
        })
        .catch(() => undefined);
    }, heartbeatIntervalMs);

    try {
      try {
        if (!handler) {
          throw new Error(`No handler registered for job type "${job.type}"`);
        }
        await handler(job.payload);
        if (lockLost) return;
        await completeJob(pool, job.id, workerId);
      } catch (err) {
        if (lockLost) return;
        const message = err instanceof Error ? err.message : String(err);
        await failJob(pool, job.id, workerId, message);
      }
    } catch (err) {
      // The lock was lost between our check and the complete/fail call, or complete/fail
      // itself failed unexpectedly — log and move on rather than taking down the whole batch.
      console.error(`worker ${workerId}: error finalizing job ${job.id}`, err);
    } finally {
      clearInterval(hb);
    }
  }

  async function pollOnce(): Promise<void> {
    const jobs = await claimJobs(pool, { queues, batchSize, workerId });
    if (jobs.length === 0) return;
    await runWithConcurrency(jobs, concurrency, processJob);
  }

  const claimLoop = (async () => {
    while (!stopped) {
      try {
        await pollOnce();
      } catch (err) {
        console.error(`worker ${workerId}: poll error`, err);
      }
      if (stopped) break;
      await sleep(pollIntervalMs);
    }
  })();

  const reapTimer = setInterval(() => {
    reapStaleJobs(pool, reapThresholdMs).catch((err) => {
      console.error(`worker ${workerId}: reaper sweep error`, err);
    });
  }, reapIntervalMs);

  return {
    async stop() {
      stopped = true;
      clearInterval(reapTimer);
      await claimLoop;
    },
  };
}
