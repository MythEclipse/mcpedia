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
 * It RECORDS that the schema exists. It does not verify that schema matches the
 * chain's intent beyond the table-presence check below. Run this only when the
 * database's schema already matches packages/db/src/schema.ts.
 *
 * ## Why it records per-migration, not the whole journal
 *
 * The chain now contains 0001 (the better-auth user model), which creates
 * `user`, `session`, `account` and `verification`. A database adopted before
 * 0001 existed has none of them. Recording 0001 as applied would tell drizzle
 * the tables exist when they do not, and every later run would silently skip
 * them — the auth tables would never be created, and nothing would report an
 * error. So each entry is recorded only when the tables it creates are actually
 * present, which leaves 0001 pending for `db:migrate` to apply. That is the
 * adopt → migrate path working end to end.
 */
import { createHash } from "node:crypto"
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { sql } from "drizzle-orm"
import { client, db } from "./client"
import { readMigrationJournal } from "./migrate-guard"

const migrationsFolder = new URL("../drizzle", import.meta.url).pathname

/** Mirrors drizzle's own hashing so the row we insert is indistinguishable. */
const sha256 = (content: string) =>
	createHash("sha256").update(content).digest("hex")

async function readJournal() {
	return readMigrationJournal(migrationsFolder)
}

/** Every ordinary table in `public`. */
async function existingTables(): Promise<Set<string>> {
	const rows = await db.execute(sql`
		select c.relname as name
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		where n.nspname = 'public' and c.relkind in ('r', 'p')
	`)
	const list = Array.isArray(rows)
		? rows
		: ((rows as { rows?: unknown[] }).rows ?? [])
	return new Set(
		(list as { name: string }[]).map(
			(r) => String(r.name).replace(/"/g, "").split(".").pop() ?? "",
		),
	)
}

/** Tables a migration's SQL creates. */
async function createdTables(tag: string): Promise<string[]> {
	const content = await readFile(join(migrationsFolder, `${tag}.sql`), "utf8")
	const names = new Set<string>()
	const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi
	for (const m of content.matchAll(re)) {
		names.add(
			(m[1] ?? "").replace(/"/g, "").split(".").pop()?.toLowerCase() ?? "",
		)
	}
	return [...names]
}

async function main() {
	const tables = await existingTables()

	if (!tables.has("documents")) {
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
	//
	// The tracking table does not exist yet on the hand-applied database this
	// command exists for, so a bare SELECT here throws
	// `relation "drizzle.__drizzle_migrations" does not exist` and the command
	// dies before recording anything — verified against a scratch Postgres
	// seeded with the baseline only. Create the schema and table exactly as
	// drizzle's own migrator does (pg-core/dialect.js), then count.
	await db.execute(sql`create schema if not exists drizzle`)
	await db.execute(sql`
		create table if not exists drizzle.__drizzle_migrations (
			id serial primary key,
			hash text not null,
			created_at bigint
		)
	`)
	const already = await db.execute(
		sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
	)
	const rows = Array.isArray(already)
		? already
		: ((already as { rows?: unknown[] }).rows ?? [])
	const count = rows.length > 0 ? Number((rows[0] as { n: number }).n) : 0
	if (count > 0) {
		console.log(
			`→ already tracked (${count} recorded migration(s)); nothing to do.`,
		)
		console.log(
			`  Run \`pnpm db:migrate\` to apply anything newer than what is recorded.`,
		)
		await client.end()
		process.exit(0)
	}

	// Only record the prefix whose tables are actually present. Recording a
	// migration whose tables are missing would make drizzle skip them forever.
	const present: typeof entries = []
	const pending: typeof entries = []
	for (const entry of entries) {
		const wants = await createdTables(entry.tag)
		const missing = wants.filter((t) => !tables.has(t.toLowerCase()))
		if (missing.length === 0) present.push(entry)
		else
			pending.push({
				...entry,
				tag: `${entry.tag} (missing: ${missing.join(", ")})`,
			})
	}

	if (present.length === 0) {
		console.error(
			`Refusing to adopt: no journal entry's tables are present.\n` +
				`  public.documents exists, but none of the chain's CREATE TABLE targets do —\n` +
				`  this is not a database built from this chain. Nothing was recorded.`,
		)
		await client.end()
		process.exit(1)
	}

	console.log(`→ adopting ${present.length} migration(s) as already applied:`)
	for (const entry of present) {
		const content = await readFile(
			join(migrationsFolder, `${entry.tag}.sql`),
			"utf8",
		)
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
		`\n✓ recorded ${present.length} of ${sqlFiles.length} migration file(s).`,
	)
	if (pending.length > 0) {
		console.log(
			`\n→ ${pending.length} migration(s) are NOT yet applied in this database:\n` +
				pending.map((e) => `   ${e.tag}`).join("\n") +
				`\n\nRun \`pnpm db:migrate\` to apply them.`,
		)
	} else {
		console.log(
			`\n  Future \`pnpm db:migrate\` runs will apply only migrations newer than these.`,
		)
	}
	await client.end()
}

main().catch(async (err) => {
	console.error("adopt failed:", err instanceof Error ? err.message : err)
	await client.end()
	process.exit(1)
})
