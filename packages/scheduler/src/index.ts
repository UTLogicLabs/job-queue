import { createPool } from "@job-queue/core";
import { runScheduler } from "./runScheduler.js";

const tickIntervalMs = Number(process.env.TICK_INTERVAL_MS ?? 30_000);
if (!Number.isInteger(tickIntervalMs) || tickIntervalMs < 1) {
  throw new Error(`TICK_INTERVAL_MS must be a positive integer, got "${process.env.TICK_INTERVAL_MS}"`);
}

const pool = createPool();
const handle = runScheduler(pool, { tickIntervalMs });

async function shutdown(): Promise<void> {
  await handle.stop();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
