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
# The deploy stages serve.mjs at the release ROOT and the Vite output in
# dist/ beside it, because serve.mjs resolves its root as `./dist` relative to
# its OWN module URL (serve.mjs:37). Putting the script inside dist/ makes it
# look for dist/dist and the service answers 500 with "no build found".
#
# So this launcher's shape differs from the other three on purpose: they exec a
# single bundle under dist/, this one execs a script that serves dist/.
set -euo pipefail

cd /opt/mcpedia-web/current
exec /usr/bin/node serve.mjs
