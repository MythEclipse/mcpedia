#!/usr/bin/env tsx
/**
 * Migration entrypoint with a preflight guard.
 *
 * `drizzle-kit migrate` gives no useful error when the target database was built
 * by the pre-squash hand-written migrations: it simply replays the single
 * baseline and dies on `relation "documents" already exists`. Worse, for a
 * database that drizzle IS tracking, it dies the same way on every run, because
 * the baseline's journal timestamp is newer than the recorded ones.
 *
 * This wrapper checks first and explains what to do. Run it via `pnpm db:migrate`.
 *
 * The guard is deliberately permissive about the ADDITIVE case. An adopted
 * database has `public.documents` AND tracking rows — the shape the original
 * guard refused outright — and it still needs later migrations (0001 and beyond)
 * applied. Refusing that would block the ordinary adopt → migrate path, and a
 * guard that blocks the normal case is one that gets bypassed. See
 * migrate-guard.ts for the exact rule.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator"
import { db, client } from "./client"
import { assertMigrationTargetIsClean } from "./migrate-guard"

const migrationsFolder = new URL("../drizzle", import.meta.url).pathname

async function main() {
	const guard = await assertMigrationTargetIsClean(db)

	if (!guard.ok) {
		console.error(`\n✗ ${guard.message}\n`)
		// Exit 0: the refusal is informational, and a non-zero exit would break any
		// wrapper that treats "migrate failed" as "schema is broken".
		await client.end()
		process.exit(0)
	}

	if (guard.pending.length === 0) {
		console.log("✓ database is already on the current migration chain")
		await client.end()
		return
	}

	console.log(
		`→ applying ${guard.pending.length} migration(s): ${guard.pending.join(", ")}`,
	)
	await migrate(db, { migrationsFolder })
	console.log("✓ migrations applied")
	await client.end()
}

main().catch(async (err) => {
	console.error("migration failed:", err instanceof Error ? err.message : err)
	await client.end()
	process.exit(1)
})
