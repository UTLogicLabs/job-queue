import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { enqueue, MAX_PAYLOAD_BYTES } from "../../src/enqueue.js";

function fakePool(queryImpl: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>) {
  return { query: vi.fn(queryImpl) } as unknown as Pool;
}

describe("enqueue", () => {
  it("rejects payloads over the size guard before touching the database", async () => {
    const pool = fakePool(() => {
      throw new Error("should not be called");
    });
    const bigPayload = { data: "x".repeat(MAX_PAYLOAD_BYTES) };

    await expect(enqueue(pool, "some-type", bigPayload)).rejects.toThrow(/Payload too large/);
  });

  it("returns the inserted job on success", async () => {
    const row = {
      id: "1",
      type: "send-email",
      queue: "default",
      priority: 0,
      payload: { to: "a@example.com" },
      payload_hash: "abc",
      status: "pending",
      attempts: 0,
      max_attempts: 5,
      run_at: new Date(),
      locked_by: null,
      locked_at: null,
      last_error: null,
      created_at: new Date(),
      completed_at: null,
    };
    const pool = fakePool(async () => ({ rows: [row] }));

    const { job, deduped } = await enqueue(pool, "send-email", { to: "a@example.com" });

    expect(deduped).toBe(false);
    expect(job.id).toBe("1");
    expect(job.type).toBe("send-email");
  });
});
