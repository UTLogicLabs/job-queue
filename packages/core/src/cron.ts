// cron-parser is CJS-only with no "exports" map, so its named exports aren't reliably
// statically analyzable by Node's real ESM loader (works under Vitest/Vite's bundler-based
// interop, but breaks when this runs as a plain Node ESM process, e.g. the worker/scheduler
// runtimes) — import the CJS module as a single default and destructure from it instead.
import cronParser from "cron-parser";
const { parseExpression } = cronParser;

export function computeNextRunAt(cronExpr: string, after: Date): Date {
  const interval = parseExpression(cronExpr, { currentDate: after, utc: true });
  return interval.next().toDate();
}
