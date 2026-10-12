import { existsSync, readFileSync } from "node:fs"
import { sql } from "drizzle-orm"
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js"

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
 * (`db:migrate:adopt`), not something a guard should do silently.
 *
 * ## What this does NOT do
 *
 * It does not refuse merely because `public.documents` exists. An earlier
 * version did, and that was correct only while the chain was the squashed
 * baseline: once `0001_better_auth_user_model` exists, it blocked the ordinary
 * adopt → migrate path, because an adopted database has exactly the state this
 * version refuses (documents present, tracking rows present) and still needs
 * 0001 applied. A guard that refuses the normal case is a guard that gets
 * bypassed.
 *
 * So the decision is the one drizzle itself would make: replay drizzle's own
 * "is this journal entry newer than the newest recorded row?" test, then refuse
 * only when replaying the resulting batch would actually collide with the
 * schema — a CREATE TABLE for a table that is already there, or an
 * ALTER/DROP/TRUNCATE against a table that predates the batch. A batch that
 * only creates new tables and alters tables it just created is additive, and
 * additive batches are exactly what must be allowed through.
 */

export interface MigrationGuardResult {
	ok: boolean
	/** Set when ok is false. Safe to print directly. */
	message?: string
	/**
	 * Journal entries drizzle would apply on this run, in order. Empty when ok is
	 * true (either nothing pending, or the pending batch is additive).
	 */
	pending: JournalEntry[]
	/** Journal entries the guard refused, when ok is false. */
	refused?: JournalEntry[]
}

/** One entry from drizzle's `meta/_journal.json`. */
export interface JournalEntry {
	tag: string
	when: number
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

/** Where `db:migrate` and `db:migrate:adopt` keep the journal. */
const MIGRATIONS_FOLDER = new URL("../drizzle", import.meta.url).pathname

/**
 * Read the first row out of a drizzle `db.execute()` result.
 *
 * drizzle's postgres-js driver returns a BARE ARRAY of row objects, not an
 * object with a `.rows` property. Reading `.rows` yields undefined, so an
 * earlier version of this guard silently reported every database as clean —
 * verified against production: `db.execute(sql\`select ...\`)` is
 * `Array.isArray === true`, `".rows" in result === false`.
 *
 * The `.rows` shape is what node-postgres and `pg` return. Handling both keeps
 * the guard correct if the driver is ever swapped, but the array case is the
 * one that is actually exercised.
 */
function firstRow(result: unknown): Record<string, unknown> | undefined {
	if (Array.isArray(result)) {
		return result.length > 0
			? (result[0] as Record<string, unknown>)
			: undefined
	}
	const rows = (result as { rows?: unknown }).rows
	if (!Array.isArray(rows) || rows.length === 0) return undefined
	return rows[0] as Record<string, unknown>
}

/** All rows, tolerating both driver shapes (see `firstRow`). */
function allRows(result: unknown): Record<string, unknown>[] {
	if (Array.isArray(result)) return result as Record<string, unknown>[]
	const rows = (result as { rows?: unknown }).rows
	return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
}

/**
 * Load the journal. Defaults to the on-disk chain so both CLI entrypoints and
 * the tests exercise the real file; tests pass their own entries instead.
 */
export function readMigrationJournal(
	folder = MIGRATIONS_FOLDER,
): JournalEntry[] {
	const journalPath = `${folder}/meta/_journal.json`
	if (!existsSync(journalPath)) return []
	const parsed = JSON.parse(readFileSync(journalPath, "utf8"))
	const entries = parsed?.entries
	if (!Array.isArray(entries)) return []
	return entries.map((e: { tag: string; when: number }) => ({
		tag: String(e.tag),
		when: Number(e.when),
	}))
}

/** `public."account"` → `account`. Drizzle emits both quoted and bare forms. */
function relationName(raw: string): string {
	const unquoted = raw.replace(/"/g, "").trim()
	const parts = unquoted.split(".")
	return parts[parts.length - 1] ?? unquoted
}

/** `CREATE TABLE [IF NOT EXISTS] <name>` — the only additive way to add a table. */
const CREATE_TABLE =
	/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi

/** `ALTER TABLE` / `DROP TABLE` — both mutate a table's definition. */
const MUTATE_TABLE =
	/(?:alter|drop)\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([a-z0-9_."]+)/gi

/** `TRUNCATE` is destructive no matter which table it names. */
const TRUNCATE = /\btruncate\b(?:[^;]*?)\s([a-z0-9_."]+)/gi

/**
 * Why a pending batch cannot be replayed against this database, or null when it
 * can.
 *
 * Statements are examined in order against two sets: `existing` (tables the
 * database already has) and `created` (tables an earlier statement in this same
 * batch brought into being). That ordering is what makes 0001 pass — it does
 * `ALTER TABLE "account" ADD CONSTRAINT ...`, but "account" was created moments
 * earlier in the same batch, so altering it is part of adding it.
 */
function findCollision(
	statements: string[],
	existing: Set<string>,
): { reason: string; table: string } | null {
	const created = new Set<string>()

	for (const statement of statements) {
		for (const match of statement.matchAll(CREATE_TABLE)) {
			const name = relationName(match[1] ?? "")
			if (existing.has(name) && !created.has(name)) {
				return {
					reason: `it creates table "${name}", which already exists`,
					table: name,
				}
			}
			created.add(name)
		}

		for (const match of statement.matchAll(MUTATE_TABLE)) {
			const name = relationName(match[1] ?? "")
			if (existing.has(name) && !created.has(name)) {
				return {
					reason: `it ${/^\s*alter/i.test(match[0]) ? "alters" : "drops"} table "${name}", which predates the batch`,
					table: name,
				}
			}
		}

		for (const match of statement.matchAll(TRUNCATE)) {
			const name = relationName(match[1] ?? "")
			return {
				reason: `it truncates table "${name}", which is destructive to replay`,
				table: name,
			}
		}
	}

	return null
}

export async function assertMigrationTargetIsClean(
	db: QueryableDb,
	journal: JournalEntry[] = readMigrationJournal(),
): Promise<MigrationGuardResult> {
	// Does the target table already exist? If not, this is a fresh database and
	// the baseline is exactly right.
	const table = await db.execute(
		sql`select to_regclass(${TABLE})::text as regclass`,
	)
	const existing = firstRow(table)?.regclass

	if (!existing) {
		// Fresh database: the whole chain is pending. Returning `pending: []` here
		// would be a lie that costs an operator the entire schema — the caller
		// treats an empty list as "already up to date" and skips migrate() — so
		// this case must report every entry.
		return { ok: true, pending: journal }
	}

	// The table exists. Is drizzle tracking the migrations that built it, and
	// what is the newest row it has recorded?
	let tracked = 0
	let newest: number | undefined
	try {
		const rows = await db.execute(
			sql`select count(*)::text as n, max(created_at)::text as newest
				from drizzle.__drizzle_migrations`,
		)
		const row = firstRow(rows)
		tracked = Number(row?.n ?? 0)
		const raw = row?.newest
		newest = raw === null || raw === undefined ? undefined : Number(raw)
	} catch {
		// No tracking table: the originals were applied by hand. Same outcome.
		tracked = 0
	}

	if (tracked === 0) {
		return {
			ok: false,
			pending: journal,
			refused: journal,
			message:
				`Refusing to migrate: ${TABLE} already exists but drizzle has no migration record ` +
				`for it, meaning the schema was applied by hand (the pre-squash files, or the ` +
				`documented \`psql -f\` procedure). Replaying the baseline would fail with a ` +
				`duplicate-relation error.\n\n` +
				`This database already has the current schema. To start tracking it:\n` +
				`  pnpm --filter @mcpedia/db db:migrate:adopt\n` +
				`or leave it as is — nothing in CI or the deploy path runs migrations.`,
		}
	}

	// Reproduce drizzle's own selection rule verbatim (pg-core/dialect.js):
	// read the newest recorded row, then run every journal entry whose `when`
	// is strictly greater. Anything else and the guard would disagree with the
	// migrator about what is about to happen.
	const pending = journal.filter(
		(entry) =>
			newest === undefined || Number.isNaN(newest) || newest < entry.when,
	)

	if (pending.length === 0) {
		return { ok: true, pending: [] }
	}

	// Which tables exist right now, so a pending CREATE TABLE can be checked
	// against the real catalog rather than a guess about what the chain built?
	const existingTables = await listExistingTables(db)

	const statements: string[] = []
	for (const entry of pending) {
		const file = `${MIGRATIONS_FOLDER}/${entry.tag}.sql`
		if (!existsSync(file)) {
			return {
				ok: false,
				pending,
				message:
					`Refusing to migrate: journal entry "${entry.tag}" has no SQL file at ` +
					`${file}. The chain on disk and the journal disagree; nothing was run.`,
			}
		}
		statements.push(
			...readFileSync(file, "utf8").split("--> statement-breakpoint"),
		)
	}

	const collision = findCollision(statements, existingTables)
	if (!collision) {
		// Additive batch: new tables only. Let it through.
		return { ok: true, pending }
	}

	return {
		ok: false,
		pending,
		refused: pending,
		message:
			`Refusing to migrate: ${TABLE} already exists and drizzle records ${tracked} ` +
			`migration(s) for it, but the chain would replay ${pending.length} of them and ` +
			`${collision.reason}. Replaying it would fail with a duplicate-relation or ` +
			`"column already exists" error.\n\n` +
			`Pending: ${pending.map((e) => e.tag).join(", ")}\n\n` +
			`This database is not on the current chain. Reconcile it explicitly:\n` +
			`  pnpm --filter @mcpedia/db db:migrate:adopt\n` +
			`or leave it as is — nothing else in the deploy path runs migrations.`,
	}
}

/**
 * Every ordinary table in `public`, which is where this repo keeps all of them.
 * Read once, as a set, so collision detection compares against the real catalog.
 */
async function listExistingTables(db: QueryableDb): Promise<Set<string>> {
	try {
		const rows = await db.execute(
			sql`select c.relname as name
				from pg_class c
				join pg_namespace n on n.oid = c.relnamespace
				where n.nspname = 'public' and c.relkind in ('r', 'p')`,
		)
		return new Set(allRows(rows).map((r) => String(r.name)))
	} catch {
		// If the catalog is unreadable, do not silently treat every table as
		// absent — that would turn the guard into a rubber stamp. Fall back to
		// the one table we know exists, which still catches the baseline case.
		return new Set(["documents"])
	}
}

/**
 * The database handle shape this guard needs.
 *
 * `PostgresJsDatabase` re-exported WITHOUT generics defaults its schema
 * parameter to `Record<string, never>`, and a concrete
 * `PostgresJsDatabase<typeof schema>` is NOT assignable to that — the error
 * reads as a schema mismatch and has nothing to do with the guard.
 *
 * Widening the parameter to a bare `Record<string, unknown>` is what actually
 * works, and it is legal because the installed drizzle constrains
 * `TSchema extends Record<string, unknown>` (verified in
 * drizzle-orm/postgres-js/driver.d.ts, not recalled). `unknown` is rejected by
 * that constraint; the Record form satisfies it while accepting every concrete
 * schema.
 */
export type AnyDatabase = PostgresJsDatabase<Record<string, unknown>>
