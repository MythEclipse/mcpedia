# syntax=docker/dockerfile:1
#
# MCPedia API — production image.
#
# Build from the REPO ROOT, because the service resolves @mcpedia/* through the
# pnpm workspace and a context of apps/api would not contain them:
#
#   docker build -f apps/api/Dockerfile -t mcpedia-api .
#
# WHY THIS BUILDS A BUNDLE INSTEAD OF RUNNING THE TYPESCRIPT
# apps/api/src/index.ts imports sibling workspace packages by bare specifier
# (@mcpedia/queue, @mcpedia/core), which those packages resolve to TypeScript
# source. Node cannot load that unaided — it needs a bundler, a loader hook, or
# tsx in the runtime image. scripts/build-bundles.mjs already solves this, and it
# is what CI ships: one esbuild file with every workspace import and every npm
# dependency inlined. Reusing it means this image and the systemd deploy run the
# SAME artifact, so a difference between the two is a difference in packaging
# only.
#
# The runtime stage therefore needs no node_modules at all, only node itself.
# That is the whole reason the image is worth the trouble.

# --- build -------------------------------------------------------------------
FROM node:22-alpine AS build

ENV CI=1

# pnpm is pinned to the exact version in package.json's packageManager field.
# A floating "latest pnpm" resolves workspace links and the lockfile differently
# from the version the gate verified, and --frozen-lockfile turns that into a
# confusing "lockfile is not up to date" rather than a version mismatch.
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

WORKDIR /w

# Manifests BEFORE source. This is the layer that makes dependency installs
# cacheable: editing any .ts file changes nothing below this line, so the
# install is not re-run. The manifest list has to be complete, though — a
# workspace member's package.json is an input to dependency resolution, so
# copying only the root manifest would resolve @mcpedia/* against nothing.
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

# --frozen-lockfile is the point of the exercise: fail here, at build time, if
# the manifests and pnpm-lock.yaml disagree. Letting the lockfile float would
# ship an image whose dependency graph no CI run ever verified.
RUN pnpm install --frozen-lockfile

COPY scripts/build-bundles.mjs scripts/

# ALL app sources, not just this service's. build-bundles.mjs builds api, mcp and
# worker in ONE esbuild pass and hard-fails the whole build if any entry point is
# missing, so copying only apps/api produces:
#   [ERROR] Could not resolve "/w/apps/worker/src/index.ts"
# which names the absent file and never mentions that the script was happy to
# build services this image does not want. Selecting instead of copying would
# mean maintaining a second bundle script; all three bundles cost nothing here.
COPY apps/    apps/
COPY packages/ packages/

# This emits api/dist/index.js, api/dist/migrate.js and copies the drizzle
# .sql journal alongside them. All three are needed: the first is the service,
# the second is the migration entrypoint, and the third is read off disk at
# runtime because esbuild inlines JavaScript only.
RUN pnpm run build:bundles

# Fail the build rather than ship an image whose migrator would report success
# while applying nothing. build-bundles.mjs already throws if the journal is
# empty; this asserts the artifact actually landed.
RUN test -s apps/api/dist/index.js \
 && test -s apps/api/dist/migrate.js \
 && ls apps/api/dist/drizzle/*.sql >/dev/null

# --- runtime -----------------------------------------------------------------
FROM node:22-alpine AS runtime

# The bundle resolves its drizzle folder via `new URL("../drizzle",
# import.meta.url)`, i.e. relative to the file itself, so dist/ has to stay a
# sibling of migrate.js rather than becoming the WORKDIR's only child.
WORKDIR /app

COPY --from=build --chown=node:node /w/apps/api/dist/ /app/dist/

# node (uid 1000) ships in the base image. Nothing in the payload needs root, and
# a writable-by-anyone /app is how a container escape turns into a foothold on
# the host. The bundle only reads.
USER node

ENV NODE_ENV=production \
    API_PORT=4020

EXPOSE 4020

# EXEC form, deliberately. In the shell form (/bin/sh -c "...") every ${...} is
# POSIX parameter expansion performed before node ever sees the string, so a
# ${PORT} here would expand to the shell's idea of PORT — empty — and the probe
# would silently test nothing. As an argv array there is no shell to expand it.
#
# The port is written out rather than read from the environment for the same
# reason, and because HEALTHCHECK cannot interpolate ENV either.
#
# /health, not /ready: this endpoint deliberately does not touch Postgres or
# Redis. A liveness probe that fails on a slow database restarts a perfectly
# healthy process, turning a degradation into an outage.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4020/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# `node` directly, not the image's docker-entrypoint.sh: no init, no root, no
# wrapper between the container's PID 1 and the service.
CMD ["node", "dist/index.js"]
