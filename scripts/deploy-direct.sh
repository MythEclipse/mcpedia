#!/usr/bin/env bash
# Deploy MCPedia from a git SHA onto this host's systemd units.
#
# Runs ON the host as the deploy user (passwordless sudo), invoked by CI as:
#     bash deploy-direct.sh <git-sha>
#
# CI copies this file out of the checkout it just built instead of running the
# copy inside /home/code/mcpedia. Running it from the active release is a
# chicken-and-egg trap: a fix to the deploy script could never take effect,
# because the copy that would apply it is the stale one.
set -euo pipefail

SHA="${1:?usage: deploy-direct.sh <git-sha>}"
REPO=/home/code/mcpedia
PNPM=/home/code/.local/bin/pnpm
# Explicit URL: the checkout's `origin` may point at a local mirror that lags
# GitHub, and a deploy must land the SHA CI just tested, not a 10-minute-old
# tip.
REMOTE_URL="${MCPEDIA_REMOTE:-https://github.com/asepharyana/mcpedia.git}"

# src:dst pairs. The dst paths are exactly what the launchers in
# /opt/mcpedia-api/bin, /opt/mcpedia-mcp/bin and /opt/mcpedia-worker/bin exec.
BUNDLES=(
  "apps/api/dist/index.js:/opt/mcpedia-api/share/mcpedia-api/dist/index.js"
  "apps/mcp/dist/http.js:/opt/mcpedia-mcp/share/mcpedia-mcp/dist/http.js"
  "apps/worker/dist/index.js:/opt/mcpedia-worker/share/mcpedia-worker/dist/index.js"
)
UNITS=(mcpedia-api mcpedia-mcp mcpedia-worker mcpedia-web)

cd "$REPO"

# ── 1. Land the code ────────────────────────────────────────────────────────
git fetch --quiet "$REMOTE_URL" "$SHA"
git reset --hard --quiet FETCH_HEAD
echo "checked out $(git rev-parse --short HEAD)"

# ── 2. Dependencies ────────────────────────────────────────────────────────
# Server-side install: node_modules must match the lockfile CI verified with
# --frozen-lockfile, otherwise the bundle built here differs from the one the
# gates saw.
"$PNPM" install --frozen-lockfile

# ── 3. Build everything BEFORE anything live is touched ─────────────────────
# A failed build must leave the running services on their current payload.
node scripts/build-bundles.mjs
(cd apps/web && ./node_modules/.bin/next build)

# ── 4. Back up the running bundles so step 6 can undo a bad swap ────────────
BACKUP="$(mktemp -d /tmp/mcpedia-deploy.XXXXXX)"
restore_bundles() {
  local pair dst
  for pair in "${BUNDLES[@]}"; do
    dst="${pair#*:}"
    if [ -f "$BACKUP/$dst" ]; then
      install -D -m 0644 "$BACKUP/$dst" "$dst"
    fi
  done
}

for pair in "${BUNDLES[@]}"; do
  dst="${pair#*:}"
  if [ -f "$dst" ]; then
    mkdir -p "$BACKUP/$(dirname "$dst")"
    cp -p "$dst" "$BACKUP/$dst"
  fi
done

# ── 5. Swap payloads in ─────────────────────────────────────────────────────
for pair in "${BUNDLES[@]}"; do
  src="${pair%%:*}"
  dst="${pair#*:}"
  install -D -m 0644 "$src" "$dst"
  echo "installed $dst"
done

sudo systemctl restart "${UNITS[@]}"

# ── 6. Health ───────────────────────────────────────────────────────────────
# `systemctl restart` already waited for the units to be up; the HTTP probes
# pace themselves (curl --retry) rather than sleeping on a guessed delay.
fail=0
probe() {
  local url="$1" want="$2" code
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    --retry 10 --retry-connrefused --retry-delay 1 --retry-all-errors \
    --max-time 15 "$url" || echo 000)
  if grep -qw -- "$code" <<< "$want"; then
    echo "OK   $url -> $code"
  else
    echo "FAIL $url -> $code (want: $want)"
    fail=1
  fi
}

probe http://127.0.0.1:4020/health "200"
# The MCP endpoint answers 406 to a bare GET: it is alive and demanding the
# Streamable-HTTP Accept header. 000 (no connection) is the failure we care about.
probe http://127.0.0.1:4021/mcp "406 400 401 405"
probe http://127.0.0.1:4016/ "200"

for unit in "${UNITS[@]}"; do
  state="$(systemctl is-active "$unit" || true)"
  echo "unit $unit -> $state"
  if [ "$state" != "active" ]; then
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo "health check failed — restoring previous bundles and restarting"
  restore_bundles
  sudo systemctl restart "${UNITS[@]}" || true
  exit 1
fi

rm -rf "$BACKUP"
echo "deploy OK $SHA"
