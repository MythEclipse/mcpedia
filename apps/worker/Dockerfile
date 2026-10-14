# syntax=docker/dockerfile:1
#
# MCPedia queue worker — production image.
#
# Build from the REPO ROOT, because the service resolves @mcpedia/* through the
# pnpm workspace and a context of apps/worker would not contain them:
#
#   docker build -f apps/worker/Dockerfile -t mcpedia-worker .
#
# WHY THIS BUILDS A BUNDLE INSTEAD OF RUNNING THE TYPESCRIPT
# apps/worker/src/index.ts imports sibling workspace packages by bare specifier
# (@mcpedia/core, @mcpedia/queue), which resolve to TypeScript source. Node cannot
# load that unaided. scripts/build-bundles.mjs already solves it and is what CI
# ships, so this image and the systemd deploy run the SAME artifact.
#
# NO HEALTHCHECK, and that is not an omission. This service is a queue consumer:
# it listens on nothing and answers no request, so there is no endpoint to probe.
# A container that starts, stays up, and holds no port is CORRECT here. The
# usual alternatives are both worse:
#
#   - a sleep-based "is it alive" probe   → reports the state it cannot observe
#   - `CMD ["true"]` as a healthcheck      → passes forever, so a dead consumer
#                                          looks identical to a working one
#
# Liveness for this service is the supervisor's: restart policy on exit, plus the
# worker's own retry and backoff against Postgres/Redis.
#
# The trade-off worth stating plainly: a container that cannot report unhealthy
# will not be restarted by an orchestrator that only acts on health. For a
# process whose failure mode is exiting, `restart: unless-stopped` is the correct
# mechanism, and a healthcheck would add a second, weaker one.

# --- build -------------------------------------------------------------------
FROM node:22-alpine AS build

ENV CI=1

# pnpm is pinned to the exact version in package.json's packageManager field: a
# floating "latest pnpm" resolves workspace links and the lockfile differently
# from the version CI's gate verified, and --frozen-lockfile reports that as a
# confusing "lockfile is not up to date" rather than a version mismatch.
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /w

# Manifests BEFORE source: this is the layer that makes dependency installs
# cacheable, so editing a .ts file invalidates nothing above it. The list must be
# COMPLETE — a workspace member's package.json is an input to dependency
# resolution, so copying only the root manifest resolves @mcpedia/* against
# nothing.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/api/package.json      apps/api/
COPY apps/mcp/package.json      apps/mcp/
COPY apps/mcp-client/package.json apps/mcp-client/
COPY apps/web/package.json     apps/web/
COPY apps/worker/package.json  apps/worker/
COPY packages/config/package.json packages/config/
COPY packages/core/package.json   packages/core/
COPY packages/db/package.json     packages/db/
COPY packages/parser/package.json packages/parser/
COPY packages/queue/package.json  packages/queue/
COPY packages/types/package.json  packages/types/
COPY scripts/package.json     scripts/

# --frozen-lockfile is the point: fail here, at build time, if the manifests and
# pnpm-lock.yaml disagree. Letting the lockfile float would ship an image whose
# dependency graph no CI run ever verified.
RUN pnpm install --frozen-lockfile

COPY scripts/build-bundles.mjs scripts/

# ALL app sources: build-bundles.mjs builds api, mcp and worker in one esbuild
# pass and fails the whole build if any entry point is missing, naming only the
# absent file. Copying just apps/worker gives:
#   [ERROR] Could not resolve "/w/apps/api/src/index.ts"
COPY apps/    apps/
COPY packages/ packages/

RUN pnpm run build:bundles

# Assert the artifact landed: a green esbuild run that wrote nothing is the
# failure this catches.
RUN test -s apps/worker/dist/index.js

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app

COPY --from=build --chown=node:node /w/apps/worker/dist/ /app/dist/

# node (uid 1000) ships in the base image. Nothing in the payload needs root, and
# a world-writable /app is how a container escape becomes a foothold on the host.
USER node

ENV NODE_ENV=production

# No EXPOSE: there is no port. Declaring one would imply a reachable service that
# does not exist.

# `node` directly, not the base image's docker-entrypoint.sh: no init, no root,
# no wrapper between the container's PID 1 and the service. Without an init, a
# zombie is unreaped for the life of the container — harmless in a one-shot
# consumer, but the base image's entrypoint already provides it for free.
CMD ["node", "dist/index.js"]