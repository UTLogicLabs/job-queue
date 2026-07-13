import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { runWorker } from "../../src/runWorker.js";
import { createHandlerRegistry } from "../../src/registry.js";

function fakePool() {
  return {
    query: vi.fn(() => {
      throw new Error("pool should not be touched when options are invalid");
    }),
  } as unknown as Pool;
}

describe("runWorker validation", () => {
  it("throws synchronously on a non-integer batchSize instead of claiming jobs", () => {
    expect(() =>
      runWorker(fakePool(), createHandlerRegistry(), {
        queues: ["default"],
        workerId: "worker-1",
        batchSize: Number.NaN,
      })
    ).toThrow(/batchSize must be a positive integer/);
  });

  it("throws synchronously on a non-integer concurrency", () => {
    expect(() =>
      runWorker(fakePool(), createHandlerRegistry(), {
        queues: ["default"],
        workerId: "worker-1",
        batchSize: 10,
        concurrency: Number.NaN,
      })
    ).toThrow(/concurrency must be a positive integer/);
  });

  it("throws on an empty queues list", () => {
    expect(() =>
      runWorker(fakePool(), createHandlerRegistry(), {
        queues: [],
        workerId: "worker-1",
      })
    ).toThrow(/queues must contain at least one queue name/);
  });
});
