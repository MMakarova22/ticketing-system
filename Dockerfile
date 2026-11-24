# syntax=docker/dockerfile:1
# Single application image: NestJS API serving the compiled React SPA on port 3000.
# Database migrations are applied automatically on container start.

ARG NODE_IMAGE=node:26.13.1-bookworm-slim

# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
# openssl: required by the Prisma schema engine (migrations); ca-certificates: TLS to external SMTP relays.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# All dependencies (including dev) for building.
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

# ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json prisma.config.ts ./
COPY prisma ./prisma
COPY apps ./apps
# prisma.config.ts requires DATABASE_URL to be set; generate does not connect, so a placeholder is enough.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate \
 && npm run build -w apps/web \
 && npm run build -w apps/api

# ---------------------------------------------------------------------------
# Production dependencies only: repo root (prisma CLI + dotenv for migrations) and the API workspace.
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace apps/api --include-workspace-root

# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=3000
COPY --from=prod-deps /app ./
COPY prisma.config.ts ./
COPY prisma ./prisma
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# No shell script on purpose (avoids CRLF issues on Windows checkouts).
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node apps/api/dist/main.js"]
