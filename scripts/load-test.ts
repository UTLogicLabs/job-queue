import { execFileSync } from "node:child_process";
import { createPool } from "@job-queue/core";

// Proves exactly-once processing under concurrent workers, per docs/ARCHITECTURE.md's "Load
// test" section: seed a batch of jobs, let `docker-compose --scale worker=N` process them,
// hard-kill one worker mid-run, and confirm every job still completes exactly once (no
// duplicate-completion unique-violation, no job left behind).
//
// Usage:
//   docker-compose up -d --scale worker=10 postgres worker scheduler
//   npm run load-test
//
// Env vars: JOB_COUNT (default 50000), POLL_INTERVAL_MS (default 2000),
// TIMEOUT_MS (default 300000), SKIP_KILL (set to skip the mid-run docker kill step).

const JOB_COUNT = Number(process.env.JOB_COUNT ?? 50_000);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 2000);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 300_000);
const SKIP_KILL = process.env.SKIP_KILL !== undefined;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runningWorkerContainers(): string[] {
  try {
    const out = execFileSync("docker", ["compose", "ps", "-q", "worker"], {
      encoding: "utf8",
    });
    return out.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const pool = createPool();

  console.log(`load-test: clearing jobs/schedules/completions, seeding ${JOB_COUNT} jobs`);
  await pool.query("truncate table completions, schedules, jobs restart identity cascade");
  await pool.query(
    `insert into jobs (type, queue, payload)
     select 'task', 'default', jsonb_build_object('n', n)
     from generate_series(1, $1) as n`,
    [JOB_COUNT]
  );

  let killed = false;
  const startedAt = Date.now();

  while (Date.now() - startedAt < TIMEOUT_MS) {
    const { rows } = await pool.query<{ status: string; count: string }>(
      "select status, count(*) as count from jobs group by status"
    );
    const byStatus = new Map(rows.map((r) => [r.status, Number(r.count)]));
    const completed = byStatus.get("completed") ?? 0;
    const dead = byStatus.get("dead") ?? 0;
    const processing = byStatus.get("processing") ?? 0;
    const pending = byStatus.get("pending") ?? 0;
    console.log(
      `load-test: pending=${pending} processing=${processing} completed=${completed} dead=${dead}`
    );

    if (!killed && !SKIP_KILL && completed > 0 && completed < JOB_COUNT) {
      const containers = runningWorkerContainers();
      if (containers.length > 0) {
        const target = containers[0];
        console.log(`load-test: hard-killing worker container ${target} mid-run`);
        execFileSync("docker", ["kill", target]);
      } else {
        console.log("load-test: no running worker containers found, skipping the kill step");
      }
      killed = true;
    }

    if (completed + dead === JOB_COUNT) break;
    await sleep(POLL_INTERVAL_MS);
  }

  const { rows: finalRows } = await pool.query<{ status: string; count: string }>(
    "select status, count(*) as count from jobs group by status"
  );
  const finalByStatus = new Map(finalRows.map((r) => [r.status, Number(r.count)]));
  const completed = finalByStatus.get("completed") ?? 0;
  const dead = finalByStatus.get("dead") ?? 0;

  const { rows: completionRows } = await pool.query<{ count: string }>(
    "select count(*) as count from completions"
  );
  const completionCount = Number(completionRows[0].count);

  await pool.end();

  console.log("load-test: final tally", { jobCount: JOB_COUNT, completed, dead, completionCount });

  const ok = completed === JOB_COUNT && dead === 0 && completionCount === JOB_COUNT;
  if (!ok) {
    console.error("load-test: FAILED — not all jobs completed exactly once within the timeout");
    process.exitCode = 1;
    return;
  }
  console.log("load-test: PASSED — every job completed exactly once");
}

main().catch((err) => {
  console.error("load-test: crashed", err);
  process.exitCode = 1;
});
