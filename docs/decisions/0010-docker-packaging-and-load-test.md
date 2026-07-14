# 0010. Docker packaging per service, and a scriptable load test proving exactly-once processing

Status: Accepted
Date: 2026-07-13

## Context

`docs/ARCHITECTURE.md`'s "Docker Compose layout" and "Load test" sections describe scaling
workers horizontally (`docker-compose up --scale worker=N`) and proving no duplicate job
processing under that scale, but nothing had been built yet — `docker-compose.yml` only had
`postgres`/`postgres_test`, and no service had a `Dockerfile`.

ADR 0009 (dashboard listener) had sketched running the SSE listener as a second background
process alongside `react-router-serve` in the same container. That design doesn't actually work:
two `node` processes have separate memory, so a standalone listener process's `fanout`/
`aggregates` would never be the instance actually serving web requests — those lazily start
their *own* listener singleton on first request, per `getListener()`'s module-scope-singleton
design. Docker packaging surfaced this before it shipped.

## Decision

- **One Dockerfile per service** (`packages/worker/Dockerfile`, `packages/scheduler/Dockerfile`,
  `apps/dashboard/Dockerfile`), each built with the repo root as build context (`context: .` in
  `docker-compose.yml`) since npm workspaces need every workspace's `package.json` present to
  install correctly.
- **Worker and scheduler run the same command as `npm run dev`**: `node --experimental-strip-types
  src/index.ts`. Neither has a compiled build step — they run TypeScript directly today, so
  there's nothing to build for production either. `npm ci` + copy source is the whole image.
- **Dashboard gets a real multi-stage build**: `npm run build --workspace=@job-queue/dashboard`
  (Vite/React Router's SSR bundle) in a build stage, then a runtime stage running
  `react-router-serve build/server/index.js` — one process, no second listener process. The
  listener still starts lazily on first request, exactly as in `react-router dev`; this was
  already the documented behavior in ADR 0009, just not yet wired into a container.
- **Worker ID no longer defaults to PID**: `packages/worker/src/index.ts` now falls back to
  `worker-${hostname()}-${process.pid}` instead of `worker-${process.pid}`. Every container's
  main process is PID 1, so under `--scale worker=N` the old default would give every replica the
  same worker ID.
- **A real "task" handler is now registered** in the worker (`registry.register("task", ...)`,
  a few milliseconds of simulated work) — needed for the load test's jobs to actually complete;
  previously no handler was registered anywhere.
- **Load test is a plain script** (`scripts/load-test.ts`, run via `npm run load-test`), not a
  new test framework or CI job: truncates and bulk-inserts `JOB_COUNT` (default 50,000) jobs with
  one `insert ... select from generate_series(...)` (fast — no per-row round trip), polls job
  status counts, hard-kills one running `worker` container mid-run via `docker kill` (not a
  graceful `SIGTERM` — this is what actually exercises the reaper's heartbeat/lease recovery
  rather than a clean shutdown), and asserts at the end that `completed == JOB_COUNT`, `dead ==
  0`, and `count(completions) == JOB_COUNT` — the last of these is the exactly-once proof per
  ARCHITECTURE.md ("a unique-violation on this insert is a live, direct assertion failure").

## Consequences

- Running the full 50k-job load test requires Docker and the `docker compose` v2 CLI plugin
  (the script shells out to `docker compose ps -q worker` and `docker kill`); it degrades
  gracefully (skips the kill step, logs why) if no worker containers are found, so it can still
  be run against plain `npm run dev` processes for a quick correctness check without Docker.
- Each Dockerfile installs the full root `npm ci` (all workspaces' dependencies, including dev
  dependencies) rather than a dependency-pruned production install — larger images than strictly
  necessary, accepted for a personal project where build simplicity matters more than image size.
- `scripts/load-test.ts` isn't part of any workspace, so it isn't covered by `npm run typecheck`
  or the existing lint/test projects — verified instead by actually running it end-to-end against
  a real Compose stack.
- Rejected: giving worker/scheduler a compiled build step to strip dev dependencies from the
  runtime image — no other part of this project uses a build step for plain TS execution, so
  introducing one just for Docker would be new complexity solving a problem (image size) nobody
  has raised.
