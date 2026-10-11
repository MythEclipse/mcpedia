#!/usr/bin/env tsx
/**
 * Adopt an EXISTING database into drizzle's migration tracking.
 *
 * The situation this exists for: this repo's migrations were originally four
 * hand-written SQL files applied with `psql -f`, which left the schema in
 * place but no `drizzle.__drizzle_migrations` rows. The chain was later
 * squashed to a single generated baseline. `db:migrate` correctly refuses to
 * replay that baseline against a database that already has the tables, but
 * refusing alone is not a way forward — this performs the one-time adoption so
 * the database is tracked and future migrations run normally.
 *
 * drizzle-kit has no flag for this. `drizzle-kit migrate --baseline` does not
 * exist in 0.31.11 — `drizzle-kit migrate --help` lists only `--config`.
 * Adopting is a manual insert of the baseline's journal entry, which is what
 * drizzle itself would have written had it run the migration.
 *
 * It RECORDS that the schema exists. It does not verify the schema matches. Run
 * this only when the database's schema already matches packages/db/src/schema.ts.
 */
import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { db, client } from "./client"
import { assertMigrationTargetIsClean } from "./migrate-guard"

const migrationsFolder = new URL("../drizzle", import.meta.url).pathname

/** Mirrors drizzle's own hashing so the row we insert is indistinguishable. */
const sha256 = (content: string) =>
	createHash("sha256").update(content).digest("hex")

async function readJournal(): Promise<
	{ idx: number; when: number; tag: string }[]
> {
	const raw = await readFile(
		join(migrationsFolder, "meta/_journal.json"),
		"utf8",
	)
	return JSON.parse(raw).entries
}

async function main() {
	const guard = await assertMigrationTargetIsClean(db)
	if (guard.ok) {
		console.error(
			"Refusing to adopt: no `documents` table found. This command records that an\n" +
				"existing schema is already in place — run `pnpm db:migrate` on a fresh database instead.",
		)
		await client.end()
		process.exit(1)
	}

	const entries = await readJournal()
	if (entries.length === 0) {
		console.error(
			"Refusing to adopt: drizzle/meta/_journal.json has no entries.",
		)
		await client.end()
		process.exit(1)
	}

	// Guard against adopting twice.
	const already = await db.execute(
		sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
	)
	const count =
		Array.isArray(already) && already.length > 0
			? Number((already[0] as { n: number }).n)
			: 0
	if (count > 0) {
		console.log(
			`→ already tracked (${count} recorded migration(s)); nothing to do.`,
		)
		await client.end()
		process.exit(0)
	}

	console.log(`→ adopting ${entries.length} migration(s) as already applied:`)
	for (const entry of entries) {
		const sqlFile = join(migrationsFolder, `${entry.tag}.sql`)
		const content = await readFile(sqlFile, "utf8")
		const hash = sha256(content)

		await db.execute(sql`
			insert into drizzle.__drizzle_migrations (hash, created_at)
			values (${hash}, ${entry.when})
			on conflict do nothing
		`)
		console.log(`   ${entry.tag}  (created_at ${entry.when})`)
	}

	const files = await readdir(migrationsFolder)
	const sqlFiles = files.filter((f) => f.endsWith(".sql"))
	console.log(
		`\n✓ recorded ${entries.length} of ${sqlFiles.length} migration file(s).\n` +
			`  Future ` +
			"`pnpm db:migrate`" +
			` runs will apply only migrations newer than these.`,
	)
	await client.end()
}

main().catch(async (err) => {
	console.error("adopt failed:", err instanceof Error ? err.message : err)
	await client.end()
	process.exit(1)
})
