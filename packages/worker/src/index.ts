import { hostname } from "node:os";
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

// Falls back to the container/host name, not the PID — every container's main process is PID 1,
// so under `docker compose --scale worker=N` a PID-based default would collide across replicas.
const workerId = process.env.WORKER_ID ?? `worker-${hostname()}-${process.pid}`;

const pool = createPool();
const registry = createHandlerRegistry();

// "task" is the generic job type used by the load test (see scripts/load-test.ts) to prove
// exactly-once processing under concurrent workers. Real job-type handlers for actual product
// work get registered here alongside it as they're introduced.
registry.register("task", async () => {
  await new Promise((resolve) => setTimeout(resolve, 5 + Math.random() * 20));
});

const handle = runWorker(pool, registry, { queues, batchSize, workerId });

async function shutdown(): Promise<void> {
  await handle.stop();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
