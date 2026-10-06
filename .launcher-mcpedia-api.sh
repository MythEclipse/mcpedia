#!/usr/bin/env bash
# Native launcher for the MCPedia API.
#
# The previous launcher was a Nix binary wrapper that exec'd a bun from
# /nix/store. Since Nix was uninstalled that path no longer exists, so the
# service could not be restarted at all. The application itself is plain
# TypeScript using @hono/node-server and node: builtins, so it runs directly
# on the system Node — no bundler-specific runtime required.
#
# `dist/index.js` is a self-contained esbuild bundle (the source imports .ts
# across workspace packages, which Node cannot resolve unaided), so the payload
# is the only thing this needs to point at.
set -euo pipefail

cd /opt/mcpedia-api/share/mcpedia-api
exec /usr/bin/node dist/index.js