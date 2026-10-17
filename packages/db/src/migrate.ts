#!/usr/bin/env tsx
/**
 * The migration WORKER, as a LIBRARY.
 *
 * `runMigrations` is exported so apps/api/src/migrate.ts — the production
 * entrypoint the deploy pipeline runs — can own process exit codes and
 * operator-facing output while reusing this.
 *
 * ## WHY THERE IS NO `main()` HERE ANY MORE
 *
 * This file used to end with a `main()` guarded by
 * `import.meta.url === pathToFileURL(process.argv[1]).href` — the standard
 * "only run when invoked directly" idiom, and correct for unbundled Node.
 * esbuild BREAKS it: the production `migrate.js` bundle inlines this module and
 * apps/api/src/migrate.ts into ONE file, so both modules share one
 * `import.meta.url`, BOTH guards compared equal, and BOTH ran.
 *
 * The observable result was a failed deploy with
 * `migration failed: Failed query: insert into "sections" ...` on the LAST seed
 * row. Two migrators ran concurrently against one shared `client`; the first to
 * finish called `await client.end()`, closing the pool under the second, whose
 * in-flight insert then died with a bare Drizzle "Failed query" and NO SQLSTATE
 * — `CONNECTION_ENDED`, not a constraint violation. The seed is
 * `on conflict do nothing`, so a duplicate could not have been the cause; the
 * error shape is what identified it.
 *
 * The guard's own docstring said its purpose was preventing "two concurrent
 * migrators racing on the same schema". A guard that bundling silently disables
 * cannot do that, so the duplicate entrypoint is REMOVED rather than
 * re-guarded: this module is now a pure library with no top-level side effects,
 * and exactly one entrypoint (apps/api/src/migrate.ts) exists to be bundled.
 * `scripts/build-bundles.mjs` asserts that count at build time.
 *
 * Local use goes through the SAME entrypoint the deploy runs — see the
 * `db:migrate` script in this package's package.json — so the local path and the
 * deploy path cannot disagree about what "migrated" means.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator"
import type { AnyDatabase } from "./migrate-guard"
import { assertMigrationTargetIsClean } from "./migrate-guard"
import { seedSections } from "./seed-sections"

const migrationsFolder = new URL("../drizzle", import.meta.url).pathname

/**
 * Preflight, then apply every pending migration.
 *
 * Returns what happened rather than exiting, so the caller decides whether a
 * refusal is fatal. `applied: 0` with `ok: false` means the guard refused the
 * database; `ok: true` with `applied: 0` means it was already current. Both are
 * non-fatal to the schema, and conflating them would make an already-current
 * database look like an error.
 */
export interface MigrationOutcome {
	readonly ok: boolean
	/** Journal TAGS applied, in order. Names, not entries — this is for logs. */
	readonly applied: readonly string[]
	/** Section ids the seed actually inserted. Empty once they all exist. */
	readonly seeded: readonly string[]
	readonly message: string
}

export async function runMigrations(
	db: AnyDatabase,
): Promise<MigrationOutcome> {
	const guard = await assertMigrationTargetIsClean(db)
	if (!guard.ok) {
		// `message` is optional on the guard result because it only carries text
		// for the refusal case — and this IS that case. Falling back to a generic
		// string keeps the return type non-optional, so a caller can never forget
		// to handle a missing message.
		return {
			ok: false,
			applied: [],
			seeded: [],
			message: guard.message ?? "refused",
		}
	}
	if (guard.pending.length === 0) {
		// The seed still runs on an already-current database. It is the reason a
		// rename survives a deploy: ON CONFLICT DO NOTHING means an operator's
		// edited label is never overwritten, while a section that is missing
		// entirely (a database migrated before this table existed) gets created.
		const seeded = await seedSections(db)
		return {
			ok: true,
			applied: [],
			seeded,
			message:
				seeded.length > 0
					? `database is already on the current migration chain; seeded ${seeded.length} section(s)`
					: "database is already on the current migration chain",
		}
	}
	await migrate(db, { migrationsFolder })
	// After the migration, so the `sections` table exists. On the deploy path
	// this is what turns the hardcoded labels the site used to carry into rows.
	const seeded = await seedSections(db)
	return {
		ok: true,
		applied: guard.pending.map((entry) => entry.tag),
		seeded,
		message:
			`applied ${guard.pending.length} migration(s)` +
			// Reported here too, not just on the no-op path: a deploy where the
			// schema moved AND the registry was populated is exactly the one an
			// operator wants to see both facts for.
			(seeded.length > 0 ? `; seeded ${seeded.length} section(s)` : ""),
	}
}
