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

# src:dst pairs. The dst paths are exactly what the launchers under
# /opt/mcpedia-{api,mcp,worker,web}/bin exec. Each entry may be a single file
# (the esbuild service bundles) or a directory (the SPA dist), and both shapes
# are handled by the backup and restore steps below.
BUNDLES=(
  "apps/api/dist/index.js:/opt/mcpedia-api/share/mcpedia-api/dist/index.js"
  "apps/mcp/dist/http.js:/opt/mcpedia-mcp/share/mcpedia-mcp/dist/http.js"
  "apps/worker/dist/index.js:/opt/mcpedia-worker/share/mcpedia-worker/dist/index.js"
  "apps/web/dist:/opt/mcpedia-web/share/mcpedia-web/dist"
  "apps/web/serve.mjs:/opt/mcpedia-web/share/mcpedia-web/serve.mjs"
)
UNITS=(mcpedia-api mcpedia-mcp mcpedia-worker mcpedia-web)

# Launchers: the executable each unit's ExecStart actually invokes, kept outside
# BUNDLES because they need mode 0755 rather than 0644 and must land outside the
# payload tree.
#
# They were shipped in the repo and installed on the host by hand, but this
# script never touched them — so a checkout that changed a launcher would deploy
# successfully and run the OLD one, indefinitely, with nothing in the output to
# suggest otherwise. The unit says "run this binary"; the binary is half the
# contract, and a deploy that ships one half is not a deploy.
LAUNCHERS=(
  ".launcher-mcpedia-api.sh:/opt/mcpedia-api/bin/mcpedia-api"
  ".launcher-mcpedia-mcp.sh:/opt/mcpedia-mcp/bin/mcpedia-mcp"
  ".launcher-mcpedia-worker.sh:/opt/mcpedia-worker/bin/mcpedia-worker"
  ".launcher-mcpedia-web.sh:/opt/mcpedia-web/bin/mcpedia-web"
)

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
(cd apps/web && ./node_modules/.bin/vite build)

# ── 3b. Apply pending migrations ────────────────────────────────────────────
# The deploy path never ran migrations, so a schema change shipped the code
# that reads a column the database does not have. The failure lands on the
# first request that touches the new column, which is after the restart, which
# is after the health probe that still passes — so the deploy reports success
# and the site is broken until someone notices.
#
# Running it HERE, between the build and the swap, means a migration that cannot
# be applied aborts the deploy while the running services are still on the
# previous payload. `set -e` does the aborting: a genuine failure exits non-zero
# and the script stops before the swap in step 5.
#
# `--filter` runs the package's own script, which is `tsx src/migrate.ts`:
# the wrapper that calls drizzle's migrator behind assertMigrationTargetIsClean.
# That wrapper exits 0 when its preflight guard REFUSES (the guard is advisory
# by design — see packages/db/src/migrate.ts), so a refusal prints its reason
# and the deploy continues. That is the guard's intended behaviour for an
# already-adopted database and is left as-is here; changing it would change what
# the guard means.
"$PNPM" --filter @mcpedia/db db:migrate

echo "migrations applied"

# ── 4. Back up the running bundles so step 6 can undo a bad swap ────────────
BACKUP="$(mktemp -d /tmp/mcpedia-deploy.XXXXXX)"

# Each dst may be a single file (today's esbuild bundles) or a directory (the
# Vite SPA that replaces apps/web's Next build). `test -f` is false for a
# directory, so a directory destination would be skipped by both the backup and
# the restore — mcpedia-web would be restarted onto a build nobody can roll
# back, and the health probe could still pass on a stale one. Handle both.
backup_path() {
  local dst="$1"
  if [ -d "$dst" ]; then
    mkdir -p "$BACKUP/$(dirname "$dst")"
    cp -a "$dst" "$BACKUP/$dst"
  elif [ -f "$dst" ]; then
    mkdir -p "$BACKUP/$(dirname "$dst")"
    cp -p "$dst" "$BACKUP/$dst"
  fi
}

restore_bundles() {
  local pair dst
  for pair in "${BUNDLES[@]}"; do
    dst="${pair#*:}"
    if [ -d "$BACKUP/$dst" ]; then
      rm -rf "$dst"
      mkdir -p "$(dirname "$dst")"
      cp -a "$BACKUP/$dst" "$dst"
    elif [ -f "$BACKUP/$dst" ]; then
      sudo install -D -m 0644 "$BACKUP/$dst" "$dst"
    fi
  done
}

# Units and launchers are restored by the same failure path as payloads.
#
# They have to be. A health probe that fails after the units were replaced has
# already left the services running the NEW unit definitions; restoring only the
# payloads and then restarting would reboot the broken units into the broken
# units. The rollback has to undo everything the deploy changed, or it is not a
# rollback.
restore_units_and_launchers() {
  local pair dst
  for pair in "${LAUNCHERS[@]}"; do
    dst="${pair#*:}"
    [ -f "$BACKUP/$dst" ] && sudo install -D -m 0755 "$BACKUP/$dst" "$dst"
  done
  local unit
  for unit in "${UNITS[@]}"; do
    dst="/etc/systemd/system/$unit.service"
    [ -f "$BACKUP/$dst" ] && sudo install -D -m 0644 "$BACKUP/$dst" "$dst"
  done
  sudo systemctl daemon-reload
}

for pair in "${BUNDLES[@]}"; do
  dst="${pair#*:}"
  backup_path "$dst"
done

for pair in "${LAUNCHERS[@]}"; do
  dst="${pair#*:}"
  backup_path "$dst"
done

for unit in "${UNITS[@]}"; do
  backup_path "/etc/systemd/system/$unit.service"
done

# ── 5. Swap payloads in ─────────────────────────────────────────────────────
for pair in "${BUNDLES[@]}"; do
  src="${pair%%:*}"
  dst="${pair#*:}"
  if [ -d "$src" ]; then
    rm -rf "$dst"
    mkdir -p "$(dirname "$dst")"
    cp -a "$src" "$dst"
  else
    install -D -m 0644 "$src" "$dst"
  fi
  echo "installed $dst"
done

# ── 5b. Install the unit definitions ────────────────────────────────────────
# The units used to live only on the host, and they pointed WorkingDirectory at
# /home/code/mcpedia — a checkout that has since been deleted. Nothing about the
# running process revealed it: nothing restarts a running process, so
# `systemctl is-active` kept reporting "active" right up until someone rebooted
# the host and every mcpedia unit died with "Failed to load environment files" /
# result 'resources', before ever reaching its launcher.
#
# Shipping the units in deploy/systemd/ and installing them here means the
# definition a service runs under is reviewable, diffable and rolled back with
# the code, instead of being host state that survives every deploy unchanged.
# A unit fix that lives only in /etc cannot be reviewed and will be lost.
for unit in "${UNITS[@]}"; do
  src="$REPO/deploy/systemd/$unit.service"
  if [ ! -f "$src" ]; then
    echo "missing $src — refusing to deploy against unknown unit definitions" >&2
    exit 1
  fi
  backup_path "/etc/systemd/system/$unit.service"
  sudo install -m 0644 "$src" "/etc/systemd/system/$unit.service"
done

for pair in "${LAUNCHERS[@]}"; do
  src="$REPO/${pair%%:*}"
  dst="${pair#*:}"
  if [ ! -f "$src" ]; then
    echo "missing $src — refusing to deploy without its launcher" >&2
    exit 1
  fi
  backup_path "$dst"
  sudo install -m 0755 "$src" "$dst"
done

sudo systemctl daemon-reload

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
  # Restore the unit definitions too. They are part of what this deploy changed,
  # and restarting into a unit the health probe just rejected is not a rollback.
  restore_units_and_launchers
  sudo systemctl restart "${UNITS[@]}" || true
  exit 1
fi

rm -rf "$BACKUP"
echo "deploy OK $SHA"
