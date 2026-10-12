#!/usr/bin/env bash
# Deploy MCPedia from a git SHA onto this host's systemd units.
#
# Runs ON the host as the deploy user (passwordless sudo), invoked by CI as:
#     bash deploy-direct.sh <git-sha>
#
# CI copies this file out of the checkout it just built rather than running the
# copy that is already on disk. Running it from the active release is a
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

# ── Release layout ──────────────────────────────────────────────────────────
# /opt/mcpedia-<svc>/releases/<sha>/ holds the payload for one SHA and `current`
# is a symlink to it. Every other service on this host works this way (hub, GMW,
# scraper, zeavis) and it is the only layout where a rollback is one `ln -sfn`.
#
# The previous layout overwrote files in place under share/<svc>/dist, and that
# has two consequences worth naming:
#
#   1. Rollback was not a rollback. With exactly one live copy there is no
#      previous one to return to, so undoing a bad deploy meant hand-copying a
#      file out of a timestamped backup directory that only existed if someone
#      had happened to run a deploy while it worked.
#   2. A half-written payload is a live payload. `cp` is not atomic, so a deploy
#      interrupted between the copy and the restart left the services running a
#      MIX of old and new files. With releases/, the new payload is assembled
#      somewhere nothing points at yet and only becomes reachable by flipping one
#      symlink, which is atomic.
#
# It also makes a release immutable: nothing writes inside releases/<sha>/ after
# `current` points at it. That guarantee is load-bearing for CONTENT_ROOT — the
# content mirror resolved to <payload>/content and would mkdirSync() new
# directories inside the running release.
ROOT=/opt
# KEEP_RELEASES counts the LIVE release too, so 2 means "what is running plus one
# rollback target". Every repo on this host is capped at 2 for the same reason:
# the disk is shared, and a third release is a rollback nobody reaches for.
KEEP_RELEASES="${MCPEDIA_KEEP_RELEASES:-2}"

SERVICES=(api mcp worker web)
UNITS=(mcpedia-api mcpedia-mcp mcpedia-worker mcpedia-web)

release_dir()  { printf '%s/mcpedia-%s/releases/%s' "$ROOT" "$1" "$SHA"; }
current_link() { printf '%s/mcpedia-%s/current' "$ROOT" "$1"; }

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
# and the script stops before the swap in step 6.
"$PNPM" --filter @mcpedia/db db:migrate

echo "migrations applied"

# ── 4. Assemble the release ────────────────────────────────────────────────
# Staged into releases/<sha>/ with nothing live touched, so any failure here
# leaves production on the previous release and the half-built directory is not
# reachable from `current`.
for svc in "${SERVICES[@]}"; do
  rel="$(release_dir "$svc")"
  rm -rf "$rel"
  mkdir -p "$rel/dist"

  case "$svc" in
    api)    src="$REPO/apps/api/dist/index.js" ;;
    mcp)    src="$REPO/apps/mcp/dist/http.js" ;;
    worker) src="$REPO/apps/worker/dist/index.js" ;;
    web)    src="$REPO/apps/web/dist" ;;
  esac

  if [ -d "$src" ]; then
    cp -a "$src/." "$rel/dist/"
  else
    install -m 0644 "$src" "$rel/dist/$(basename "$src")"
  fi
  echo "assembled $rel"
done

# The web service serves its dist through a stdlib static server that does not
# live in node_modules, so it ships with the release. Kept out of the launcher so
# the launcher stays a bare exec with no file to keep in sync.
install -m 0644 "$REPO/apps/web/serve.mjs" "$(release_dir web)/serve.mjs"

# ── 5. Install the unit definitions ─────────────────────────────────────────
# The units used to live only on the host, and they pointed WorkingDirectory at
# /home/code/mcpedia — a checkout that has since been deleted. Nothing about the
# running process revealed it: nothing restarts a running process, so
# `systemctl is-active` kept reporting "active" right up until someone rebooted
# the host and every mcpedia unit died with "Failed to load environment files" /
# result 'resources', before ever reaching its launcher.
#
# Shipping the units in deploy/systemd/ and installing them here means the
# definition a service runs under is reviewable, diffable and rolled back with
# the code, instead of being host state that survives every deploy unchanged. A
# unit fix that lives only in /etc cannot be reviewed and will be lost.
for unit in "${UNITS[@]}"; do
  src="$REPO/deploy/systemd/$unit.service"
  if [ ! -f "$src" ]; then
    echo "missing $src — refusing to deploy against unknown unit definitions" >&2
    exit 1
  fi
  sudo install -m 0644 "$src" "/etc/systemd/system/$unit.service"
done
# The launcher is the executable ExecStart actually invokes. It was shipped in
# the repo and installed on the host by hand while the script only ever restarted
# it, so a checkout that changed a launcher deployed "successfully" and ran the
# old one indefinitely with nothing in the output to suggest otherwise. The unit
# says "run this binary"; the binary is half the contract.
for svc in "${SERVICES[@]}"; do
  src="$REPO/.launcher-mcpedia-$svc.sh"
  if [ ! -f "$src" ]; then
    echo "missing $src — refusing to deploy without its launcher" >&2
    exit 1
  fi
  sudo install -m 0755 "$src" "/opt/mcpedia-$svc/bin/mcpedia-$svc"
done

sudo systemctl daemon-reload

# ── 6. Preflight, then flip ────────────────────────────────────────────────
# Every unit must exec through current/. A unit still naming a concrete share/
# directory would keep running the OLD payload while this script reported
# success — the same failure mode as a unit left over from the previous release,
# which is why it is checked rather than assumed.
for svc in "${SERVICES[@]}"; do
  exec_path="$(sudo systemctl show "mcpedia-$svc" -p ExecStart --value)"
  case "$exec_path" in
    */mcpedia-$svc/current*) ;;
    *)
      echo "unit mcpedia-$svc does not exec through current/: ${exec_path:-<unknown>}" >&2
      exit 1
      ;;
  esac
done

for svc in "${SERVICES[@]}"; do
  link="$(current_link "$svc")"
  mkdir -p "$(dirname "$link")"
  # Create beside the old link and rename over it. `ln -sfn` alone is not atomic
  # because it unlinks first, which leaves a window where the link does not exist
  # and a restart landing in that window resolves nothing.
  sudo ln -sfn "$(release_dir "$svc")" "${link}.new"
  sudo mv -T "${link}.new" "$link"
  echo "flipped $link -> $SHA"
done

sudo systemctl restart "${UNITS[@]}"

# ── 7. Health ───────────────────────────────────────────────────────────────
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
probe http://127.0.0.1:4021/mcp "200 400 401 405 406"
probe http://127.0.0.1:4016/ "200"
probe https://wiki.asepharyana.my.id/ "200"

for unit in "${UNITS[@]}"; do
  state="$(systemctl is-active "$unit" || true)"
  echo "unit $unit -> $state"
  [ "$state" = "active" ] || fail=1
done

# ── 8. Roll back on a failed probe ─────────────────────────────────────────
# Only the symlinks go back. With releases/ the previous payload is still
# sitting there untouched, so "roll back" is pointing `current` at it — there is
# nothing to copy and no state to reconstruct, which is the entire reason for
# moving to this layout.
if [ "$fail" -ne 0 ]; then
  echo "health check failed — restoring the previous release"
  for svc in "${SERVICES[@]}"; do
    link="$(current_link "$svc")"
    rel_root="$(dirname "$link")"
      previous="$(find "$rel_root/releases" -maxdepth 1 -mindepth 1 -type d \
        ! -name "$SHA" -printf '%f\n' | sort -r | head -1)"
      if [ -n "$previous" ]; then
        # Searched inside releases/, so the target is built the same way.
        # Joining against rel_root would name /opt/mcpedia-<svc>/<sha>, which
        # does not exist — and ln -sfn would create a DANGLING link, which is a
        # rollback that reports success and starts nothing.
        sudo ln -sfn "$rel_root/releases/$previous" "${link}.rollback"
        sudo mv -T "${link}.rollback" "$link"
        echo "rolled back $svc -> $previous"
    else
      echo "no previous release for $svc to fall back to" >&2
    fi
  done
  sudo systemctl restart "${UNITS[@]}" || true
  exit 1
fi

# ── 9. Prune ────────────────────────────────────────────────────────────────
# The live release is resolved THROUGH `current` rather than compared by name.
# A name comparison misses the trailing slash that readlink prints, so it would
# happily prune the release that is currently running — the bug that shipped
# alongside this layout in the other repos on this host.
for svc in "${SERVICES[@]}"; do
  link="$(current_link "$svc")"
  rel_root="$(dirname "$link")"
  live="$(readlink -f "$link")"
    # Scoped to releases/ for the same reason as the rollback search: the
    # service root also holds share/ and bin/, and pruning a maxdepth-1
    # directory there would delete a launcher or the old layout's leftovers
    # rather than a release.
    mapfile -t releases < <(
      find "$rel_root/releases" -maxdepth 1 -mindepth 1 -type d -printf '%f\n' | sort -r
    )
    for name in "${releases[@]:$KEEP_RELEASES}"; do
      [ -n "$name" ] || continue
      target="$rel_root/releases/$name"
      if [ "$(readlink -f "$target")" = "$live" ]; then
        echo "SKIP $target (live)"
        continue
      fi
      # sudo: /opt is root-owned, and a prune that silently failed would
      # leave the disk growing while the log claims otherwise.
      sudo rm -rf "$target"
      echo "pruned $target"
  done
done

echo "deploy OK $SHA"
for svc in "${SERVICES[@]}"; do
  echo "  mcpedia-$svc -> $(readlink -f "$(current_link "$svc")")"
done