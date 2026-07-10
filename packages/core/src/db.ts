import { Pool, type PoolConfig } from "pg";

export function createPool(config: PoolConfig = {}): Pool {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ...config,
  });
}
