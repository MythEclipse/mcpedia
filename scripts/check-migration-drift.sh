#!/usr/bin/env bash
# Fail the build when the Drizzle schema has changed without a migration.
#
# ## WHY THIS EXISTS
#
# `drizzle-kit generate` does not fail when the schema has moved ahead of
# `drizzle/`. It writes a new migration and exits 0. So a schema edit that
# forgets to be committed passes every gate and then fails in production at
# deploy time, when `db:migrate` applies nothing because there is no migration
# to apply — the deploy looks green and the new column does not exist.
#
# This script runs generate and then asks a different question: did anything
# change? If yes, someone edited a schema without committing a migration, and
# the build stops here.
#
# ## WHY IT RUNS IN A COPY
#
# `drizzle-kit generate` writes into `packages/db/drizzle/`. Running it in the
# checkout would leave an untracked migration behind in the working tree, so a
# developer running this locally would find files appearing. It copies the
# schema, config and existing migrations to a temp directory, runs generate
# there, and diffs. The checkout is only read.
#
# Verified both directions on this repo's schema at 0001_better_auth_user_model:
# a clean schema produces "No schema changes, nothing to migrate" and no diff;
# adding a table produces a new 0002_*.sql plus a changed _journal.json and
# snapshot, and this script exits 1.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_DIR="$REPO_ROOT/packages/db"

# drizzle-kit is a devDependency of @mcpedia/db, so it resolves from that
# package's own .bin. Not the workspace root's.
DRIZZLE_KIT="$DB_DIR/node_modules/.bin/drizzle-kit"
if [ ! -x "$DRIZZLE_KIT" ]; then
  echo "error: $DRIZZLE_KIT not found — run 'pnpm install' first" >&2
  exit 1
fi

WORK="$(mktemp -d /tmp/mcpedia-drift.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

cp -a "$DB_DIR/src" "$WORK/src"
cp -a "$DB_DIR/drizzle" "$WORK/drizzle"
cp -a "$DB_DIR/drizzle.config.ts" "$WORK/drizzle.config.ts"
cp -a "$DB_DIR/package.json" "$WORK/package.json"

# `generate` needs a DATABASE_URL to read the config, but it never connects —
# it diffs the schema against the snapshot files. The placeholder keeps the
# config's import of @mcpedia/config from throwing on a missing variable.
#
# drizzle-kit resolves the config's `schema: "./src/schema.ts"` relative to the
# PROCESS WORKING DIRECTORY, not to the config file's own directory — verified:
# run from /tmp with --config /tmp/x/drizzle.config.ts it exits 1 with
# "No schema files found for path config ['./src/schema.ts']". So the copy has to
# be the cwd. `(cd ... && ...)` rather than `--config "$WORK/..."` alone.
DATABASE_URL="${DATABASE_URL:-postgres://drift-check:drift-check@127.0.0.1:5432/drift_check}" \
  sh -c 'cd "$1" && "$2" generate --config drizzle.config.ts' sh "$WORK" "$DRIZZLE_KIT" >/dev/null

if diff -rq "$WORK/drizzle" "$DB_DIR/drizzle" >/dev/null 2>&1; then
  echo "migration check: no drift — packages/db/schema.ts matches packages/db/drizzle/"
  exit 0
fi

cat >&2 <<'MSG'
migration check: DRIFT

packages/db/src/schema.ts has changes that no committed migration in
packages/db/drizzle/ accounts for. Committing the schema alone will deploy
green and leave the new columns absent in production.

Fix, and commit the generated files together with the schema change:

  pnpm --filter @mcpedia/db db:generate

Generated:

MSG
diff -rq "$WORK/drizzle" "$DB_DIR/drizzle" >&2 || true

exit 1