import { describe, expect, it, vi } from "vitest";
import type { JobEvent } from "@job-queue/core";
import { createFanout } from "../../server/fanout.js";

function event(overrides: Partial<JobEvent> = {}): JobEvent {
  return { id: "1", type: "task", queue: "default", status: "pending", from: null, ...overrides };
}

describe("createFanout", () => {
  it("delivers a broadcast event to every subscriber", () => {
    const fanout = createFanout();
    const a = vi.fn();
    const b = vi.fn();
    fanout.subscribe(a);
    fanout.subscribe(b);

    const evt = event();
    fanout.broadcast(evt);

    expect(a).toHaveBeenCalledWith(evt);
    expect(b).toHaveBeenCalledWith(evt);
  });

  it("stops delivering events after unsubscribe", () => {
    const fanout = createFanout();
    const fn = vi.fn();
    const unsubscribe = fanout.subscribe(fn);

    unsubscribe();
    fanout.broadcast(event());

    expect(fn).not.toHaveBeenCalled();
  });

  it("tracks the number of active subscribers", () => {
    const fanout = createFanout();
    const unsubscribe = fanout.subscribe(() => {});
    expect(fanout.size).toBe(1);

    unsubscribe();
    expect(fanout.size).toBe(0);
  });

  it("isolates a throwing subscriber from the rest", () => {
    const fanout = createFanout();
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const ok = vi.fn();
    fanout.subscribe(throwing);
    fanout.subscribe(ok);

    expect(() => fanout.broadcast(event())).not.toThrow();
    expect(ok).toHaveBeenCalled();
  });
});
