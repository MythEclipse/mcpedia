#!/usr/bin/env bash
# Native launcher for the MCPedia BullMQ worker.
#
# Replaces the Nix wrapper that exec'd /nix/store/.../bun. The worker only
# imports @mcpedia/queue and BullMQ, so it runs on the system Node unchanged.
# See .launcher-mcpedia-api.sh for the shared rationale.
set -euo pipefail

cd /opt/mcpedia-worker/share/mcpedia-worker
exec /usr/bin/node dist/index.js