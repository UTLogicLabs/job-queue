# Build context is the repo root (npm workspaces need every workspace's package.json present
# to install correctly) — see docker-compose.yml's `build.context` for this service.
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/worker/package.json ./packages/worker/package.json
COPY packages/scheduler/package.json ./packages/scheduler/package.json
COPY apps/dashboard/package.json ./apps/dashboard/package.json

RUN npm ci

COPY packages/core ./packages/core
COPY apps/dashboard ./apps/dashboard

RUN npm run build --workspace=@job-queue/dashboard

FROM node:24-alpine
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/apps/dashboard ./apps/dashboard

WORKDIR /app/apps/dashboard
ENV NODE_ENV=production
CMD ["/app/node_modules/.bin/react-router-serve", "build/server/index.js"]
