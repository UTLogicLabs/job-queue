// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

const unsubscribe = vi.fn();
const fanout = { subscribe: vi.fn().mockReturnValue(unsubscribe) };
const aggregates = { getSnapshot: vi.fn().mockReturnValue({ queueDepth: [], throughputPerMin: 0, failureRatePercent: 0, lastReconciledAt: new Date(0).toISOString() }) };

vi.mock("../server/listener.js", () => ({
  getListener: vi.fn().mockResolvedValue({ fanout, aggregates }),
}));

const { loader } = await import("../app/routes/dashboard.events.js");

function requestWithAbort() {
  const controller = new AbortController();
  const request = new Request("http://localhost/dashboard/events", { signal: controller.signal });
  return { request, abort: () => controller.abort() };
}

describe("dashboard/events loader", () => {
  it("returns an SSE response with the correct headers", async () => {
    const { request } = requestWithAbort();
    const response = await loader({ request } as never);

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });

  it("subscribes to the fanout when the stream starts", async () => {
    const { request } = requestWithAbort();
    const response = await loader({ request } as never);

    // Reading a chunk forces the ReadableStream's start() to run.
    const reader = response.body!.getReader();
    await reader.read();

    expect(fanout.subscribe).toHaveBeenCalled();
  });

  it("unsubscribes when the request is aborted", async () => {
    const { request, abort } = requestWithAbort();
    const response = await loader({ request } as never);

    const reader = response.body!.getReader();
    await reader.read();

    abort();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unsubscribe).toHaveBeenCalled();
  });
});
