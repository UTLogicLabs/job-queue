import type { Client } from "pg";
import { createListenerClient, createPool, parseJobEvent } from "@job-queue/core";
import { createFanout, type Fanout } from "./fanout.js";
import { createAggregates, type Aggregates } from "./aggregates.js";

const RECONCILE_INTERVAL_MS = 20_000;
const RECONNECT_DELAY_MS = 2000;

export type DashboardListenerHandle = {
  fanout: Fanout;
  aggregates: Aggregates;
  stop: () => Promise<void>;
};

async function start(): Promise<DashboardListenerHandle> {
  const pool = createPool();
  const fanout = createFanout();
  const aggregates = createAggregates(pool);

  let client: Client;
  let stopped = false;

  function wireClient(c: Client): void {
    c.on("notification", (msg) => {
      if (msg.channel !== "job_events" || !msg.payload) return;
      try {
        const event = parseJobEvent(msg.payload);
        aggregates.applyEvent(event);
        fanout.broadcast(event);
      } catch (err) {
        console.error("dashboard listener: bad notification payload", err);
      }
    });

    c.on("error", (err) => {
      console.error("dashboard listener: pg client error", err);
      if (!stopped) reconnect();
    });
  }

  async function connect(): Promise<Client> {
    const c = createListenerClient();
    wireClient(c);
    await c.connect();
    await c.query("LISTEN job_events");
    return c;
  }

  function reconnect(): void {
    setTimeout(() => {
      if (stopped) return;
      connect()
        .then((c) => {
          client = c;
        })
        .catch((err) => {
          console.error("dashboard listener: reconnect failed", err);
          reconnect();
        });
    }, RECONNECT_DELAY_MS);
  }

  client = await connect();

  // Seed real numbers before serving any client — cold start must not show all zeros.
  await aggregates.reconcileNow();
  const reconcileTimer = aggregates.startReconcileLoop(RECONCILE_INTERVAL_MS);

  return {
    fanout,
    aggregates,
    async stop() {
      stopped = true;
      clearInterval(reconcileTimer);
      await client.query("UNLISTEN job_events").catch(() => undefined);
      await client.end();
      await pool.end();
    },
  };
}

export function getListener(): Promise<DashboardListenerHandle> {
  const g = globalThis as { __jobQueueListener?: Promise<DashboardListenerHandle> };
  if (!g.__jobQueueListener) {
    g.__jobQueueListener = start();
  }
  return g.__jobQueueListener;
}
