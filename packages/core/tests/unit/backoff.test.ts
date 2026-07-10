import { describe, expect, it } from "vitest";
import { backoffMs } from "../../src/backoff.js";

describe("backoffMs", () => {
  it("grows exponentially with attempts", () => {
    const noJitter = () => 0;
    expect(backoffMs(0, { baseMs: 1000, random: noJitter })).toBe(1000);
    expect(backoffMs(1, { baseMs: 1000, random: noJitter })).toBe(2000);
    expect(backoffMs(3, { baseMs: 1000, random: noJitter })).toBe(8000);
  });

  it("caps at maxMs", () => {
    const noJitter = () => 0;
    expect(backoffMs(10, { baseMs: 1000, maxMs: 5000, random: noJitter })).toBe(5000);
  });

  it("adds jitter bounded by baseMs", () => {
    const fullJitter = () => 1;
    expect(backoffMs(0, { baseMs: 1000, random: fullJitter })).toBe(2000);
  });
});
