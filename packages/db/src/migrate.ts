#!/usr/bin/env tsx
/**
 * The migration WORKER, as a library.
 *
 * `runMigrations` is exported so apps/api/src/migrate.ts — the production
 * entrypoint the deploy pipeline runs — can own process exit codes and
 * operator-facing output while reusing this. The alternative, a second copy of
 * the guard-and-apply sequence, is exactly how a deploy path and a local path
 * end up disagreeing about what "migrated" means.
 *
 * This file is still runnable directly (`pnpm --filter @mcpedia/db db:migrate`)
 * for local use, which is why main() is still here. Both paths call the same
 * `runMigrations`.
 */
import { pathToFileURL } from "node:url"
import { migrate } from "drizzle-orm/postgres-js/migrator"
import type { AnyDatabase } from "./migrate-guard"
import { assertMigrationTargetIsClean } from "./migrate-guard"

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
		return { ok: false, applied: [], message: guard.message ?? "refused" }
	}
	if (guard.pending.length === 0) {
		return {
			ok: true,
			applied: [],
			message: "database is already on the current migration chain",
		}
	}
	await migrate(db, { migrationsFolder })
	return {
		ok: true,
		applied: guard.pending.map((entry) => entry.tag),
		message: `applied ${guard.pending.length} migration(s)`,
	}
}

/** Local entrypoint. The deploy path lives in apps/api/src/migrate.ts. */
async function main() {
	// Imported lazily so the exported helpers above can be used by a consumer
	// without this module opening a database connection at import time.
	const { db, client } = await import("./client")
	const outcome = await runMigrations(db)
	await client.end()
	if (!outcome.ok) {
		console.error(`\n✗ ${outcome.message}\n`)
		// Exit 0: the refusal is informational, and a non-zero exit would break
		// any wrapper that treats "migrate failed" as "schema is broken".
		process.exit(0)
	}
	console.log(`✓ ${outcome.message}`)
	process.exit(0)
}

/**
 * Run the local entrypoint ONLY when this file is the process entrypoint.
 *
 * This guard is load-bearing, not defensive tidiness. This module is also a
 * LIBRARY — apps/api/src/migrate.ts imports `runMigrations` from it — and an
 * unconditional `main()` at module scope therefore ran the whole migration a
 * SECOND time inside the deploy process: once from the imported module and once
 * from the importing entrypoint. The observable symptom was the failure message
 * printed twice, and in production it would have been two concurrent migrators
 * racing on the same schema, which is precisely the failure mode this file was
 * extracted to prevent.
 *
 * `import.meta.url` is compared against `process.argv[1]` because that is the
 * path the node/tsx CLI was invoked with; the resolved URLs are compared so a
 * symlinked bin or a relative invocation still matches.
 */
const isEntrypoint = (() => {
	const invoked = process.argv[1]
	if (!invoked) return false
	try {
		return import.meta.url === pathToFileURL(invoked).href
	} catch {
		return false
	}
})()

if (isEntrypoint) {
	main().catch(async (err) => {
		console.error("migration failed:", err instanceof Error ? err.message : err)
		process.exit(1)
	})
}
