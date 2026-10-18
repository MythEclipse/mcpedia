#!/usr/bin/env bash
# Native launcher for the MCPedia MCP server (Streamable HTTP transport).
#
# Replaces the Nix wrapper that exec'd /nix/store/.../bun. The entry point
# builds its server from node:http and @modelcontextprotocol/sdk, so the system
# See mcpedia-api.sh for the shared rationale.
set -euo pipefail

cd /opt/mcpedia-mcp/current
exec /usr/bin/node dist/http.js
