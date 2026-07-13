import { describe, expect, it } from "vitest";
import { runWithConcurrency } from "../../src/pool.js";

describe("runWithConcurrency", () => {
  it("processes every item exactly once", async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const seen: number[] = [];

    await runWithConcurrency(items, 4, async (item) => {
      seen.push(item);
    });

    expect(seen.sort((a, b) => a - b)).toEqual(items);
  });

  it("never runs more than `concurrency` items at once", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let inFlight = 0;
    let maxInFlight = 0;

    await runWithConcurrency(items, 3, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("handles an empty item list without error", async () => {
    await expect(runWithConcurrency([], 5, async () => {})).resolves.toBeUndefined();
  });

  it("rejects instead of silently dropping work when concurrency is NaN", async () => {
    const seen: number[] = [];
    await expect(
      runWithConcurrency([1, 2, 3], Number.NaN, async (item) => {
        seen.push(item);
      })
    ).rejects.toThrow(/concurrency must be a finite number/);
    expect(seen).toEqual([]);
  });

  it("rejects a non-positive concurrency", async () => {
    await expect(runWithConcurrency([1, 2, 3], 0, async () => {})).rejects.toThrow(
      /concurrency must be a finite number/
    );
  });
});
