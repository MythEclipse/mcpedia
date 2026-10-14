# syntax=docker/dockerfile:1
#
# MCPedia web SPA — production image.
#
# Build from the REPO ROOT: the app resolves @mcpedia/* through the pnpm
# workspace, and a context of apps/web would not contain them.
#
#   docker build -f apps/web/Dockerfile -t mcpedia-web .
#
# apps/web is a Vite SPA (vite.config.ts sets build.outDir = "dist"). The Next.js
# app it replaced is still in the tree as `build:next`, and its output is
# `.next/` — so copying `out/` here, as a Next static export would, matches
# neither build. `dist/` is where this one actually writes.
#
# The SPA reaches the API by relative path, so no VITE_API_BASE_URL exists to
# bake and no build arg is required here. That is a deliberate difference from
# zeavis-edu, where Vite inlines an API URL at build time and the Dockerfile
# guards against an empty value.

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
# cacheable, so editing a .tsx file invalidates nothing above it. The list must be
# COMPLETE — a workspace member's package.json is an input to dependency
# resolution.
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
# pnpm-lock.yaml disagree.
RUN pnpm install --frozen-lockfile

COPY apps/web/ apps/web/
# The web app imports @mcpedia/api, whose router definitions are TypeScript
# source. Vite resolves that at BUILD time through its `noServerImports` config,
# so the sources have to be present.
COPY packages/ packages/

# `vite build`, not `moon run web:build`. The moon task runs BOTH `vite build` and
# `next build`, and the Next half needs .next output this image never ships —
# running it would fail on missing inputs for no benefit.
RUN pnpm --filter @mcpedia/web run build

# Assert the artifact landed, and that it is the SPA rather than an empty dir.
RUN test -s apps/web/dist/index.html \
 && ls apps/web/dist/assets/ >/dev/null

# --- runtime -----------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# Pinned, not `nginx:alpine`: a floating tag means the config below is validated
# against a server whose directives may have changed.
# `set` is a server/location directive, NOT http-level: declaring the upstream
# variable here fails with
#   nginx: [emerg] "set" directive is not allowed here in
#     /etc/nginx/conf.d/00-upstream.conf:2
# so it lives in the server block and only the resolver is injected. The resolver
# points at Docker's embedded DNS, 127.0.0.11.
RUN echo 'resolver 127.0.0.11 valid=10s ipv6=off;' \
  > /etc/nginx/conf.d/00-upstream.conf

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /w/apps/web/dist/ /usr/share/nginx/html/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:80/ || exit 1