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

# The payload CI built, and the unit definitions from the same checkout.
#
# These are the only two inputs. There is no clone, no pnpm install, no build:
# this host is a deploy target, not a builder. That is what removes the
# checkout, node_modules, tsx and the whole toolchain from the production host —
# and with them the failure where the bundle running in production was compiled
# against whatever happened to be in the lockfile at the moment, rather than
# against the tree the gate verified.
ARTIFACT_DIR="${ARTIFACT_DIR:?set ARTIFACT_DIR to the directory CI uploaded}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/tmp/mcpedia-systemd}"

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

# ── 1. Assert the payload before touching anything ──────────────────────────
# Every failure below aborts while the previous release is still live and still
# serving, so this is the cheapest possible place to catch a truncated upload or
# a stale artifact.
for required in \
  "$ARTIFACT_DIR/api/index.js" \
  "$ARTIFACT_DIR/api/migrate.js" \
  "$ARTIFACT_DIR/mcp/http.js" \
  "$ARTIFACT_DIR/worker/index.js" \
  "$ARTIFACT_DIR/web/serve.mjs" \
  "$ARTIFACT_DIR/web/index.html"
do
  [ -s "$required" ] || { echo "payload incomplete: $required" >&2; exit 1; }
done

# The migration journal travels with the migrate bundle because drizzle reads it
# from disk relative to that bundle. Its absence is NOT loud: the migrator finds
# an empty folder and reports success while changing nothing, so the schema
# silently stops tracking the code. Asserted here for that reason specifically.
shopt -s nullglob
migrations=("$ARTIFACT_DIR/api/drizzle/"*.sql)
shopt -u nullglob
[ "${#migrations[@]}" -gt 0 ] \
  || { echo "payload has no migrations in api/drizzle — the schema would silently stop tracking the code" >&2; exit 1; }
echo "payload ok: $(find "$ARTIFACT_DIR" -type f | wc -l) files, ${#migrations[@]} migration(s)"

# ── 2. Apply pending migrations ────────────────────────────────────────────
# Before the swap, and as its own process, so a schema that cannot be migrated
# aborts the deploy with the previous release still live.
#
# It used to run via `tsx apps/api/src/migrate.ts`, which needed a checkout, a
# node_modules and tsx — the last reason this host had to be a build host. It is
# now a bundle like every other service.
#
# DATABASE_URL comes from bws-exec exactly as the units get it, so the migrator
# and the API can never be pointed at different databases.
# bws-exec, not a hand-rolled `VAR=$(bws-env ...) node ...`.
#
# The units already run through bws-exec, and reusing it here means the migrator
# and the API cannot be pointed at different databases by a typo in a shell
# pipeline. It also keeps DATABASE_URL out of this script's own environment: the
# value exists only inside the migrator's process, exactly like in production.
echo "=== migrations ==="
( cd "$ARTIFACT_DIR/api" && sudo /usr/local/bin/bws-exec mcpedia node migrate.js ) || {
  echo "migration failed (exit $?) — previous release untouched" >&2
  exit 1
}
echo "migrations applied"

# ── 3. Assemble the release ────────────────────────────────────────────────
# Staged into releases/<sha>/ with nothing live touched, so any failure here
# leaves production on the previous release and the half-built directory is not
# reachable from `current`.
for svc in "${SERVICES[@]}"; do
  rel="$(release_dir "$svc")"
  sudo rm -rf "$rel"
  sudo mkdir -p "$rel/dist"

  case "$svc" in
    api)    src="$ARTIFACT_DIR/api" ;;
    mcp)    src="$ARTIFACT_DIR/mcp" ;;
    worker) src="$ARTIFACT_DIR/worker" ;;
    web)    src="$ARTIFACT_DIR/web" ;;
  esac

  # The artifact folder for a service holds exactly what that service runs. For
  # api/mcp/worker that is a single bundle, which lands at dist/<file> because
  # the launcher execs `node dist/<file>`.
  #
  # web is the exception and the copy is deliberately split. serve.mjs resolves
  # its root as `./dist` relative to its OWN module URL (apps/web/serve.mjs:37),
  # so the script has to sit at the release ROOT with dist/ beside it. Copying
  # the whole web folder into dist/ puts the script one level too deep and the
  # service answers 500 with "no build found at .../dist/dist"; putting it at the
  # root and serving from cwd-relative dist is the shape serve.mjs was written for.
  if [ "$svc" = "web" ]; then
    sudo cp -a "$src/." "$rel/dist/"
    sudo mv "$rel/dist/serve.mjs" "$rel/serve.mjs"
  else
    sudo cp -a "$src/." "$rel/dist/"
  fi
  echo "assembled $rel"
done

# ── 4. Install the unit definitions ─────────────────────────────────────────
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
for unit in mcpedia-api mcpedia-mcp mcpedia-worker mcpedia-web; do
  src="$SYSTEMD_DIR/$unit.service"
  if [ ! -f "$src" ]; then
    echo "missing $src — refusing to deploy against unknown unit definitions" >&2
    exit 1
  fi
  sudo install -m 0644 "$src" "/etc/systemd/system/$unit.service"
done

# The launcher is the executable ExecStart actually invokes. It was installed on
# the host by hand while the script only ever restarted it, so a checkout that
# changed a launcher deployed "successfully" and ran the old one indefinitely with
# nothing in the output to suggest otherwise. The unit says "run this binary";
# the binary is half the contract.
#
# It lives in the repo, not in the artifact, because it is not a build output —
# and it is scp'd alongside deploy/systemd so the host still never checks out
# anything.
for svc in "${SERVICES[@]}"; do
  src="$SYSTEMD_DIR/.launcher-mcpedia-$svc.sh"
  if [ ! -f "$src" ]; then
    echo "missing $src — refusing to deploy without its launcher" >&2
    exit 1
  fi
  sudo install -m 0755 "$src" "/opt/mcpedia-$svc/bin/mcpedia-$svc"
done

sudo systemctl daemon-reload

# ── 5. Preflight, then flip ────────────────────────────────────────────────
# The unit must exec the launcher at /opt/mcpedia-<svc>/bin/, and that launcher
# must resolve `current` rather than a concrete release.
#
# Checking the ExecStart line for "current/" would be wrong: ExecStart names the
# launcher, and it is the launcher that cds. What actually matters is that the
# path between them is intact, so both halves are checked where each one lives.
# A unit still pointing into the old share/ tree would keep serving the previous
# payload while this script reported success — the same failure mode as a unit
# left over from the previous release.
for svc in "${SERVICES[@]}"; do
  exec_path="$(sudo systemctl show "mcpedia-$svc" -p ExecStart --value)"
  case "$exec_path" in
    *"/opt/mcpedia-$svc/bin/mcpedia-$svc"*) ;;
    *)
      echo "unit mcpedia-$svc does not exec its launcher: ${exec_path:-<unknown>}" >&2
      exit 1
      ;;
  esac
  launcher="/opt/mcpedia-$svc/bin/mcpedia-$svc"
  [ -x "$launcher" ] || { echo "launcher missing: $launcher" >&2; exit 1; }
  grep -q "cd /opt/mcpedia-$svc/current" "$launcher" \
    || { echo "launcher $launcher does not resolve current/ — a deploy would restart the old release" >&2; exit 1; }
  # And the symlink must actually point somewhere real before it is flipped.
  [ -d "$ROOT/mcpedia-$svc/releases" ] || { echo "no releases/ for $svc" >&2; exit 1; }
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
probe http://127.0.0.1:4021/mcp "200 400 401 405 406"
probe http://127.0.0.1:4016/ "200"
probe https://wiki.asepharyana.my.id/ "200"

for unit in "${UNITS[@]}"; do
  state="$(systemctl is-active "$unit" || true)"
  echo "unit $unit -> $state"
  [ "$state" = "active" ] || fail=1
done

# ── 7. Roll back on a failed probe ─────────────────────────────────────────
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

# ── 8. Prune ────────────────────────────────────────────────────────────────
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