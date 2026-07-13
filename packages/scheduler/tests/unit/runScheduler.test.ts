import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { runScheduler } from "../../src/runScheduler.js";

function fakePool() {
  return {
    connect: vi.fn(() => {
      throw new Error("pool should not be touched when options are invalid");
    }),
  } as unknown as Pool;
}

describe("runScheduler validation", () => {
  it("throws synchronously on a non-integer tickIntervalMs", () => {
    expect(() => runScheduler(fakePool(), { tickIntervalMs: Number.NaN })).toThrow(
      /tickIntervalMs must be a positive integer/
    );
  });

  it("throws synchronously on a non-integer limit", () => {
    expect(() => runScheduler(fakePool(), { limit: 0 })).toThrow(/limit must be a positive integer/);
  });
});
