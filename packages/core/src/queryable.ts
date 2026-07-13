import type { Pool, PoolClient } from "pg";

// A handful of core functions (enqueue) can run either standalone against a Pool (each
// call auto-committed on its own connection) or embedded inside a caller-managed
// transaction (a PoolClient already inside BEGIN/COMMIT) — e.g. tickScheduler enqueues a
// job as part of the same transaction that locks and advances the schedule row.
export type Queryable = Pool | PoolClient;

export function isPool(queryable: Queryable): queryable is Pool {
  // PoolClient also inherits a `.connect()` method from the underlying pg Client class, so
  // that alone doesn't distinguish it from a Pool. `.release()` is only ever present on a
  // client actually checked out from a pool (via pool.connect()) — a bare Pool never has it.
  return typeof (queryable as PoolClient).release !== "function";
}
