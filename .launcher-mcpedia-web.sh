#!/usr/bin/env bash
# Native launcher for the MCPedia web front end (Vite SPA).
#
# This used to exec `next start` against apps/web/.next. The front end was ported
# to a Vite SPA and the Next tree was deleted, so both the build output (.next)
# and the binary that served it were gone — the launcher could not outlive the
# port.
#
# What serves the SPA now is apps/web/serve.mjs, a stdlib-only static file
# server committed alongside the app. `vite preview` is deliberately NOT used:
# it lives in node_modules, which this deploy does not stage, and Vite documents
# it as a local convenience rather than a production server.
#
# The deploy stages apps/web/dist and apps/web/serve.mjs into the release
# directory, so a restart needs only a bare `node` — no installed package, no
# build toolchain.
set -euo pipefail

cd /opt/mcpedia-web/current
exec /usr/bin/node serve.mjs
