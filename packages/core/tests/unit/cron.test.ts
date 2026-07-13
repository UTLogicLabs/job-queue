import { describe, expect, it } from "vitest";
import { computeNextRunAt } from "../../src/cron.js";

describe("computeNextRunAt", () => {
  it("computes the next occurrence strictly after the given date", () => {
    const after = new Date("2026-01-01T00:00:00Z");
    const next = computeNextRunAt("*/5 * * * *", after);
    expect(next.toISOString()).toBe("2026-01-01T00:05:00.000Z");
  });

  it("handles hourly schedules", () => {
    const after = new Date("2026-01-01T00:30:00Z");
    const next = computeNextRunAt("0 * * * *", after);
    expect(next.toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });

  it("throws on an invalid cron expression", () => {
    expect(() => computeNextRunAt("not a cron expr", new Date())).toThrow();
  });
});
