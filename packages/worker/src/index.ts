import { createPool } from "@job-queue/core";
import { createHandlerRegistry } from "./registry.js";
import { runWorker } from "./runWorker.js";

const queues = (process.env.QUEUES ?? "default")
  .split(",")
  .map((q) => q.trim())
  .filter((q) => q.length > 0);

const batchSizeEnv = process.env.BATCH_SIZE;
const batchSize = batchSizeEnv === undefined ? 10 : Number(batchSizeEnv);
if (!Number.isInteger(batchSize) || batchSize < 1) {
  throw new Error(`BATCH_SIZE must be a positive integer, got "${batchSizeEnv}"`);
}

const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;

const pool = createPool();
const registry = createHandlerRegistry();

// Real job-type handlers get registered here as job types are introduced in later stages,
// e.g. registry.register("send-welcome-email", async (payload) => { ... }).

const handle = runWorker(pool, registry, { queues, batchSize, workerId });

async function shutdown(): Promise<void> {
  await handle.stop();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
