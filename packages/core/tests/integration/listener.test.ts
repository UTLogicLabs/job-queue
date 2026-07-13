import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { Client } from "pg";
import { createPool } from "../../src/db.js";
import { createListenerClient, parseJobEvent } from "../../src/listener.js";
import { enqueue } from "../../src/enqueue.js";
import { claimJobs } from "../../src/claim.js";
import { truncateAll } from "./setup.js";

function waitForNotification(client: Client, timeoutMs = 2000): Promise<string> {
  return new Promise((resolve, reject) => {
    const onNotification = (msg: { payload?: string }) => {
      clearTimeout(timer);
      resolve(msg.payload ?? "");
    };
    const timer = setTimeout(() => {
      client.removeListener("notification", onNotification);
      reject(new Error("timed out waiting for notification"));
    }, timeoutMs);
    client.once("notification", onNotification);
  });
}

describe("jobs_notify_event trigger (integration)", () => {
  let pool: Pool;
  let listener: Client;

  beforeEach(async () => {
    pool = createPool();
    await truncateAll(pool);
    listener = createListenerClient();
    await listener.connect();
    await listener.query("LISTEN job_events");
  });

  afterEach(async () => {
    await listener.end();
    await pool.end();
  });

  it("fires with from: null on insert", async () => {
    const notified = waitForNotification(listener);
    const { job } = await enqueue(pool, "task", { n: 1 });

    const event = parseJobEvent(await notified);
    expect(event).toEqual({
      id: job.id,
      type: "task",
      queue: "default",
      status: "pending",
      from: null,
    });
  });

  it("fires with the prior status on a status transition", async () => {
    const insertNotified = waitForNotification(listener);
    await enqueue(pool, "task", { n: 1 });
    await insertNotified; // drain the insert's own notification before watching for the next one

    const notified = waitForNotification(listener);
    await claimJobs(pool, { queues: ["default"], batchSize: 1, workerId: "worker-1" });

    const event = parseJobEvent(await notified);
    expect(event.status).toBe("processing");
    expect(event.from).toBe("pending");
  });

  it("does not fire on a heartbeat-only update (locked_at, no status change)", async () => {
    const insertNotified = waitForNotification(listener);
    await enqueue(pool, "task", { n: 1 });
    await insertNotified;

    const claimNotified = waitForNotification(listener);
    const [claimed] = await claimJobs(pool, {
      queues: ["default"],
      batchSize: 1,
      workerId: "worker-1",
    });
    await claimNotified;

    const notified = waitForNotification(listener, 500);
    await pool.query("update jobs set locked_at = now() where id = $1", [claimed.id]);

    await expect(notified).rejects.toThrow("timed out waiting for notification");
  });
});
