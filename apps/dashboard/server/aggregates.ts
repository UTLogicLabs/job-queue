import type { Pool } from "pg";
import type { JobEvent, JobStatus } from "@job-queue/core";

const WINDOW_MS = 60_000;

type QueueStatusKey = `${string}:${JobStatus}`;

function key(queue: string, status: JobStatus): QueueStatusKey {
  return `${queue}:${status}`;
}

export type QueueDepth = { queue: string; status: JobStatus; count: number };

export type Snapshot = {
  queueDepth: QueueDepth[];
  throughputPerMin: number;
  failureRatePercent: number;
  lastReconciledAt: string;
};

export function createAggregates(pool: Pool) {
  let byQueueStatus = new Map<QueueStatusKey, number>();
  let recentCompletions: number[] = [];
  let recentFailures: number[] = [];
  let lastReconciledAt = new Date(0);

  function prune(timestamps: number[], now: number): number[] {
    return timestamps.filter((t) => now - t <= WINDOW_MS);
  }

  function applyEvent(event: JobEvent): void {
    const now = Date.now();
    if (event.from) {
      const fromKey = key(event.queue, event.from);
      byQueueStatus.set(fromKey, Math.max(0, (byQueueStatus.get(fromKey) ?? 0) - 1));
    }
    const toKey = key(event.queue, event.status);
    byQueueStatus.set(toKey, (byQueueStatus.get(toKey) ?? 0) + 1);

    if (event.status === "completed") {
      recentCompletions = [...prune(recentCompletions, now), now];
    }
    if (event.status === "failed" || event.status === "dead") {
      recentFailures = [...prune(recentFailures, now), now];
    }
  }

  async function reconcileNow(): Promise<void> {
    const result = await pool.query<{ queue: string; status: JobStatus; count: number }>(
      "select queue, status, count(*)::int as count from jobs group by queue, status"
    );
    byQueueStatus = new Map(result.rows.map((row) => [key(row.queue, row.status), row.count]));
    lastReconciledAt = new Date();
  }

  function startReconcileLoop(intervalMs: number): ReturnType<typeof setInterval> {
    return setInterval(() => {
      reconcileNow().catch((err) => console.error("aggregates: reconcile failed", err));
    }, intervalMs);
  }

  function getSnapshot(): Snapshot {
    const now = Date.now();
    recentCompletions = prune(recentCompletions, now);
    recentFailures = prune(recentFailures, now);
    const totalRecent = recentCompletions.length + recentFailures.length;

    return {
      queueDepth: Array.from(byQueueStatus.entries()).map(([k, count]) => {
        const separatorIndex = k.lastIndexOf(":");
        const queue = k.slice(0, separatorIndex);
        const status = k.slice(separatorIndex + 1) as JobStatus;
        return { queue, status, count };
      }),
      throughputPerMin: recentCompletions.length,
      failureRatePercent: totalRecent === 0 ? 0 : (recentFailures.length / totalRecent) * 100,
      lastReconciledAt: lastReconciledAt.toISOString(),
    };
  }

  return { applyEvent, reconcileNow, startReconcileLoop, getSnapshot };
}

export type Aggregates = ReturnType<typeof createAggregates>;
