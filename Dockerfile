# syntax=docker/dockerfile:1
# hh-api gateway (ADR-025): gateway + UI only, no Python worker / Chrome.
# Registration stays on the local `full` instance; accounts arrive via transfer import.

FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 falls back to a native build when no prebuilt binary matches.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# config.ts validates env at import time and next build imports route modules.
# Build-only placeholder; it never reaches the runtime image or the repository.
ENV HH_SECRET=build-time-placeholder-0123456789abcdef
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
# runMigrations() reads ./drizzle at boot; scripts/start.mjs resolves host/port.
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
# Mount the persistent volume here (default HH_DB_PATH=./data/hh.db).
RUN mkdir -p /app/data
EXPOSE 3210
CMD ["node", "scripts/start.mjs"]