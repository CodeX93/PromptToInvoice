# syntax=docker/dockerfile:1.7
#
# One file, three runtime targets built from the same compiled source:
#   web     Next.js standalone server              docker build --target web .
#   worker  pg-boss jobs (email, PDFs, webhooks)   docker build --target worker .
#           also runs migrations:                  docker run … worker node dist/migrate.mjs
# No secrets are needed at build time; everything is read from the
# environment when the container starts.

ARG NODE_VERSION=22.23.4

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 CI=1
RUN corepack enable
WORKDIR /repo

# ── Dependencies: only manifests, so source edits don't bust this layer ──
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ai/package.json packages/ai/
COPY packages/einvoice/package.json packages/einvoice/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/tsconfig/package.json packages/tsconfig/
# Behind a TLS-inspecting proxy? Pass its CA without baking it into a layer:
#   docker build --secret id=extra_ca,src=/path/to/ca.pem …
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi \
 && pnpm install --frozen-lockfile

# ── Build ──
FROM deps AS build
COPY . .
# Pins server-action ids so a rolling deploy doesn't break open forms.
ARG DEPLOYMENT_ID=dev
ENV DEPLOYMENT_ID=${DEPLOYMENT_ID}
RUN pnpm --filter @pti/web build \
 && pnpm --filter @pti/web build:worker \
 && ! grep -rqs "__pti_build_placeholder__" apps/web/.next/server/app --include=*.html --include=*.rsc \
 && pnpm --filter @pti/web deploy --prod --legacy /out/worker

# ── web ──
FROM node:${NODE_VERSION}-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "apps/web/server.js"]

# ── worker (and migrations) ──
FROM node:${NODE_VERSION}-bookworm-slim AS worker
ENV NODE_ENV=production MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build --chown=node:node /out/worker/node_modules ./node_modules
COPY --from=build --chown=node:node /out/worker/package.json ./package.json
COPY --from=build --chown=node:node /repo/apps/web/dist ./dist
COPY --from=build --chown=node:node /repo/apps/web/assets ./assets
COPY --from=build --chown=node:node /repo/packages/db/drizzle ./drizzle
USER node
# pg-boss drains in-flight jobs on SIGTERM; give it time before SIGKILL.
STOPSIGNAL SIGTERM
CMD ["node", "--enable-source-maps", "dist/worker.mjs"]
