import type { Pool } from "pg";
import { tickScheduler } from "@job-queue/core";

export type RunSchedulerOptions = {
  tickIntervalMs?: number;
  limit?: number;
};

export type SchedulerHandle = {
  stop: () => Promise<void>;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function runScheduler(pool: Pool, options: RunSchedulerOptions = {}): SchedulerHandle {
  const { tickIntervalMs = 30_000, limit = 100 } = options;

  if (!Number.isInteger(tickIntervalMs) || tickIntervalMs < 1) {
    throw new Error(`runScheduler: tickIntervalMs must be a positive integer, got ${tickIntervalMs}`);
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`runScheduler: limit must be a positive integer, got ${limit}`);
  }

  let stopped = false;

  const tickLoop = (async () => {
    while (!stopped) {
      try {
        await tickScheduler(pool, limit);
      } catch (err) {
        console.error("scheduler: tick error", err);
      }
      if (stopped) break;
      await sleep(tickIntervalMs);
    }
  })();

  return {
    async stop() {
      stopped = true;
      await tickLoop;
    },
  };
}
