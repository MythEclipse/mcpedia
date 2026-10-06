#!/usr/bin/env bash
# Native launcher for the MCPedia web front end (Next.js).
#
# The previous launcher was doubly broken after the Nix removal: it exec'd a bun
# from /nix/store, and it copied the .next build out of a /nix/store path that no
# longer exists. Both are gone, so this service could not restart either.
#
# apps/web/.next is now built by `next build` under Node, so there is nothing to
# copy — the launcher only has to start the server. `next start` must run from
# apps/web because Next resolves its build manifest relative to the project root.
set -euo pipefail

cd /home/code/mcpedia/apps/web
exec ./node_modules/.bin/next start --port 4016