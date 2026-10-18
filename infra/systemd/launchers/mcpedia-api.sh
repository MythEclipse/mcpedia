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
#
# The path goes through the `current` symlink rather than a concrete release
# directory on purpose: a launcher naming a SHA would pin this process to one
# release forever, and a deploy would have to rewrite the launcher to move it.
# Resolving `current` at exec time makes a rollback a symlink flip alone.
set -euo pipefail

cd /opt/mcpedia-api/current
exec /usr/bin/node dist/index.js
