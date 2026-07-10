import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { createPool } from "../../src/db.js";

describe("db connectivity", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createPool();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("connects to the test database and runs a query", async () => {
    const result = await pool.query("select 1 as value");
    expect(result.rows[0]).toEqual({ value: 1 });
  });
});
