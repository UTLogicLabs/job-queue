# 0001. Monorepo layout: npm workspaces, packages/ + apps/

Status: Accepted
Date: 2026-07-10

## Context
The system has four independently-run pieces (worker, scheduler, dashboard) that all need to
share the same DB pool setup, job/enqueue types, and SQL helpers (claim query, backoff
calculation, dedupe hash). Splitting these into separate repos would duplicate that shared
code and make it easy for the schema and the queue-client logic to drift out of sync. A single
package with everything inline would blur the boundary between "library code other processes
import" and "a specific runnable process."

## Decision
One repo, npm workspaces, no separate published package (nothing here is meant to be consumed
outside this project):
- `packages/core` — db pool, `enqueue()`, job/schedule types, claim/backoff/dedupe SQL helpers.
  Imported by worker, scheduler, and dashboard.
- `packages/worker` — the claim-loop process (`docker-compose`'s `worker` service).
- `packages/scheduler` — the cron-tick process for recurring jobs.
- `apps/dashboard` — the Remix app + SSE listener process.
- `db/migrations` — schema migrations, not tied to any one workspace, run via a root script.

## Consequences
- Shared logic (schema shape, backoff math, dedupe hashing) lives in exactly one place
  (`packages/core`); worker/scheduler/dashboard depend on it via workspace protocol, so a
  schema change is felt at typecheck time everywhere it matters instead of silently drifting.
- `apps/` vs `packages/` mirrors the common convention of "things you run" vs "things you
  import" — the dashboard is the only `apps/` entry today because it's the only piece with a
  build step distinct from "run this process."
- Rejected: separate repos per process (duplicates shared types/SQL, versioning overhead with
  no actual external consumers); a single flat package with everything inline (no clear
  boundary between library code and each process's entrypoint, harder to reason about which
  process a given file belongs to).
