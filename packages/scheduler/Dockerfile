# Build context is the repo root (npm workspaces need every workspace's package.json present
# to install correctly) — see docker-compose.yml's `build.context` for this service.
FROM node:24-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/worker/package.json ./packages/worker/package.json
COPY packages/scheduler/package.json ./packages/scheduler/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json

RUN npm ci

COPY scripts/ts-resolve-loader.mjs ./scripts/ts-resolve-loader.mjs
COPY packages/core ./packages/core
COPY packages/scheduler ./packages/scheduler

WORKDIR /app/packages/scheduler
CMD ["node", "--experimental-strip-types", "--experimental-loader=../../scripts/ts-resolve-loader.mjs", "src/index.ts"]
