import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import type { JobEvent } from "@job-queue/core";
import { createAggregates } from "../../server/aggregates.js";

function event(overrides: Partial<JobEvent> = {}): JobEvent {
  return { id: "1", type: "task", queue: "default", status: "pending", from: null, ...overrides };
}

function fakePool(rows: Array<{ queue: string; status: string; count: number }> = []): Pool {
  return { query: vi.fn().mockResolvedValue({ rows }) } as unknown as Pool;
}

describe("createAggregates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("increments the destination queue/status bucket on an insert event (no from)", () => {
    const aggregates = createAggregates(fakePool());
    aggregates.applyEvent(event({ queue: "default", status: "pending", from: null }));

    const snapshot = aggregates.getSnapshot();
    expect(snapshot.queueDepth).toEqual([{ queue: "default", status: "pending", count: 1 }]);
  });

  it("decrements the from bucket and increments the to bucket on a transition", () => {
    const aggregates = createAggregates(fakePool());
    aggregates.applyEvent(event({ queue: "default", status: "pending", from: null }));
    aggregates.applyEvent(event({ queue: "default", status: "processing", from: "pending" }));

    const snapshot = aggregates.getSnapshot();
    expect(snapshot.queueDepth).toEqual(
      expect.arrayContaining([
        { queue: "default", status: "pending", count: 0 },
        { queue: "default", status: "processing", count: 1 },
      ])
    );
  });

  it("floors a from-bucket decrement at zero instead of going negative", () => {
    const aggregates = createAggregates(fakePool());
    aggregates.applyEvent(event({ queue: "default", status: "processing", from: "pending" }));

    const snapshot = aggregates.getSnapshot();
    const pendingBucket = snapshot.queueDepth.find((q) => q.status === "pending");
    expect(pendingBucket?.count ?? 0).toBe(0);
  });

  it("counts completions in the trailing 60s window as throughput", () => {
    const aggregates = createAggregates(fakePool());
    aggregates.applyEvent(event({ status: "completed", from: "processing" }));
    aggregates.applyEvent(event({ status: "completed", from: "processing" }));

    expect(aggregates.getSnapshot().throughputPerMin).toBe(2);
  });

  it("drops completions older than the 60s window out of throughput", () => {
    const aggregates = createAggregates(fakePool());
    aggregates.applyEvent(event({ status: "completed", from: "processing" }));

    vi.advanceTimersByTime(61_000);

    expect(aggregates.getSnapshot().throughputPerMin).toBe(0);
  });

  it("computes failure rate as failures over failures+completions in the window", () => {
    const aggregates = createAggregates(fakePool());
    aggregates.applyEvent(event({ status: "completed", from: "processing" }));
    aggregates.applyEvent(event({ status: "completed", from: "processing" }));
    aggregates.applyEvent(event({ status: "failed", from: "processing" }));

    expect(aggregates.getSnapshot().failureRatePercent).toBeCloseTo((1 / 3) * 100);
  });

  it("reports a 0% failure rate when there have been no recent completions or failures", () => {
    const aggregates = createAggregates(fakePool());
    expect(aggregates.getSnapshot().failureRatePercent).toBe(0);
  });

  it("reconcileNow replaces queue depth wholesale from a ground-truth query", async () => {
    const pool = fakePool([{ queue: "default", status: "pending", count: 5 }]);
    const aggregates = createAggregates(pool);
    aggregates.applyEvent(event({ queue: "emails", status: "pending", from: null }));

    await aggregates.reconcileNow();

    expect(aggregates.getSnapshot().queueDepth).toEqual([
      { queue: "default", status: "pending", count: 5 },
    ]);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("group by queue, status"));
  });

  it("updates lastReconciledAt after a successful reconcile", async () => {
    const aggregates = createAggregates(fakePool());
    expect(aggregates.getSnapshot().lastReconciledAt).toBe(new Date(0).toISOString());

    await aggregates.reconcileNow();

    expect(aggregates.getSnapshot().lastReconciledAt).toBe(new Date().toISOString());
  });
});
