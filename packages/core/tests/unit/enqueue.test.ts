import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { enqueue, MAX_PAYLOAD_BYTES } from "../../src/enqueue.js";

function fakePool(queryImpl: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>) {
  return { query: vi.fn(queryImpl) } as unknown as Pool;
}

function jobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  };
}

function uniqueViolation(constraint: string) {
  const err = new Error("duplicate key value violates unique constraint");
  return Object.assign(err, { code: "23505", constraint });
}

describe("enqueue", () => {
  it("rejects payloads over the size guard before touching the database", async () => {
    const pool = fakePool(() => {
      throw new Error("should not be called");
    });
    const bigPayload = { data: "x".repeat(MAX_PAYLOAD_BYTES) };

    await expect(enqueue(pool, "some-type", bigPayload)).rejects.toThrow(/Payload too large/);
  });

  it("rejects a payload exactly at the size limit (DB constraint is strictly less-than)", async () => {
    const pool = fakePool(() => {
      throw new Error("should not be called");
    });
    // Buffer.byteLength(JSON.stringify({ data: "x".repeat(n) })) == n + '{"data":""}'.length,
    // so pad data until the whole JSON string is exactly MAX_PAYLOAD_BYTES.
    const overhead = Buffer.byteLength(JSON.stringify({ data: "" }));
    const payload = { data: "x".repeat(MAX_PAYLOAD_BYTES - overhead) };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBe(MAX_PAYLOAD_BYTES);

    await expect(enqueue(pool, "some-type", payload)).rejects.toThrow(/Payload too large/);
  });

  it("allows a payload one byte under the size limit", async () => {
    const overhead = Buffer.byteLength(JSON.stringify({ data: "" }));
    const payload = { data: "x".repeat(MAX_PAYLOAD_BYTES - overhead - 1) };
    expect(Buffer.byteLength(JSON.stringify(payload))).toBe(MAX_PAYLOAD_BYTES - 1);

    const pool = fakePool(async () => ({ rows: [jobRow()] }));
    const { deduped } = await enqueue(pool, "some-type", payload);
    expect(deduped).toBe(false);
  });

  it("returns the inserted job on success", async () => {
    const pool = fakePool(async () => ({ rows: [jobRow()] }));

    const { job, deduped } = await enqueue(pool, "send-email", { to: "a@example.com" });

    expect(deduped).toBe(false);
    expect(job.id).toBe("1");
    expect(job.type).toBe("send-email");
  });

  it("retries the insert if the in-flight conflict clears before the lookup runs", async () => {
    let insertCalls = 0;
    const pool = fakePool(async (sql) => {
      if (sql.includes("insert into jobs")) {
        insertCalls++;
        if (insertCalls === 1) {
          throw uniqueViolation("jobs_dedupe_inflight");
        }
        return { rows: [jobRow({ id: "2" })] };
      }
      if (sql.includes("encode(sha256")) {
        return { rows: [{ hash: "somehash" }] };
      }
      // The in-flight lookup finds nothing — the original job already completed/died.
      return { rows: [] };
    });

    const { job, deduped } = await enqueue(pool, "send-email", { to: "a@example.com" });

    expect(deduped).toBe(false);
    expect(job.id).toBe("2");
    expect(insertCalls).toBe(2);
  });
});
