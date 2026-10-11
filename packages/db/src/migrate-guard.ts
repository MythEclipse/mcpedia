import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

/**
 * Preflight guard for `db:migrate`.
 *
 * The migration history in this repo was squashed from four hand-written files
 * into one generated baseline (`drizzle/0000_military_wolfpack.sql`). A database
 * that already ran the originals therefore has a schema the baseline would try
 * to create a second time, and `drizzle-kit migrate` fails with a bare
 * `relation "document_chunks" already exists`.
 *
 * Two populations hit this, and the guard has to cover both:
 *
 *  1. Hand-applied databases (including production). The originals were run with
 *     `psql -f`, so `drizzle.__drizzle_migrations` does not exist at all.
 *  2. Databases migrated by drizzle with the old journal. Those DO have tracking
 *     rows, but drizzle decides what to run purely by comparing the journal's
 *     numeric `when` against the stored timestamp (drizzle-orm migrator.js,
 *     `folderMillis: journalEntry.when`). The baseline was generated later, so
 *     its `when` is larger and drizzle attempts it on every run.
 *
 * Neither is a hypothetical: both were reproduced against a scratch Postgres.
 *
 * This function only READS. It never mutates the database — deciding how to
 * adopt the baseline on an existing database is an explicit, manual operation
 * (`drizzle-kit migrate --baseline`), not something a guard should do silently.
 */

export interface MigrationGuardResult {
	ok: boolean
	/** Set when ok is false. Safe to print directly. */
	message?: string
}

/**
 * Minimal shape this guard needs.
 *
 * `execute` is typed with drizzle's real signature rather than
 * `(q: unknown) => Promise<unknown>`: the latter is contravariant in `q`, so a
 * concrete `PostgresJsDatabase` is not assignable to it.
 */
type QueryableDb = Pick<PostgresJsDatabase, "execute">

const TABLE = "public.documents"

/** postgres-js returns a RowList, which is array-like but not an Array. */
function firstRow(result: unknown): Record<string, unknown> | undefined {
	const rows = (result as { rows?: unknown }).rows
	if (!Array.isArray(rows) || rows.length === 0) return undefined
	return rows[0] as Record<string, unknown>
}

export async function assertMigrationTargetIsClean(
	db: QueryableDb,
): Promise<MigrationGuardResult> {
	// Does the target table already exist? If not, this is a fresh database and
	// the baseline is exactly right.
	const table = await db.execute(sql`select to_regclass(${TABLE})::text as regclass`)
	const existing = firstRow(table)?.regclass

	if (!existing) {
		return { ok: true }
	}

	// The table exists. Is drizzle already tracking the migrations that built it?
	let tracked = 0
	try {
		const rows = await db.execute(
			sql`select count(*)::text as n from drizzle.__drizzle_migrations`,
		)
		tracked = Number(firstRow(rows)?.n ?? 0)
	} catch {
		// No tracking table: the originals were applied by hand. Same outcome.
		tracked = 0
	}

	if (tracked > 0) {
		return {
			ok: false,
			message:
				`Refusing to migrate: ${TABLE} already exists and drizzle records ${tracked} ` +
				`migration(s) for it, from the pre-squash history. The current chain is a single ` +
				`baseline whose timestamp is newer, so drizzle would attempt to re-create the ` +
				`tables and fail.\n\n` +
				`This database already has the current schema. Reconcile it explicitly:\n` +
				`  pnpm --filter @mcpedia/db db:migrate:baseline\n` +
				`or leave it as is — nothing else in the deploy path runs migrations.`,
		}
	}

	return {
		ok: false,
		message:
			`Refusing to migrate: ${TABLE} already exists but drizzle has no migration record ` +
			`for it, meaning the schema was applied by hand (the pre-squash files, or the ` +
			`documented \`psql -f\` procedure). Replaying the baseline would fail with a ` +
			`duplicate-relation error.\n\n` +
			`This database already has the current schema. To start tracking it:\n` +
			`  pnpm --filter @mcpedia/db db:migrate:baseline\n` +
			`or leave it as is — nothing in CI or the deploy path runs migrations.`,
	}
}

// Re-exported so callers can build a properly typed handle without importing
// drizzle's PostgresJsDatabase generics directly.
export type { PostgresJsDatabase }