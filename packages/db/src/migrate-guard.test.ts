import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import {
	assertMigrationTargetIsClean,
	readMigrationJournal,
} from "./migrate-guard"

/**
 * The guard shipped broken once: `firstRow()` read `result.rows`, but drizzle's
 * postgres-js driver returns a BARE ARRAY, so `.rows` was always undefined and
 * every database looked clean. It typechecked, it ran, it printed a reassuring
 * message — and it never refused anything.
 *
 * It then shipped broken a second way: it refused any database that had
 * `public.documents`, which was right for the squashed baseline but blocked the
 * ordinary adopt → migrate path once 0001 existed, because an adopted database
 * has documents AND tracking rows and still needs 0001 applied.
 *
 * A guard's only observable behaviour is the case where it says no, so these
 * tests exercise exactly that — plus the case the rewrite exists to get right:
 * an adopted database with a purely additive migration pending must be ALLOWED.
 * Everything runs against the real journal and the real generated SQL on disk,
 * so the test fails if the chain changes shape underneath it.
 */

const JOURNAL = readMigrationJournal()
const TAGS = JOURNAL.map((e) => e.tag)
const BASELINE = TAGS[0]
const ADDITIVE = TAGS[1]

/**
 * A stand-in db that answers by query text: `to_regclass` for the table check,
 * a tracking count for the second query, and the public-table catalog for the
 * third. The guard issues exactly these, so a single-response mock would feed
 * one result into all three reads.
 */
function fakeDb(opts: {
	tableExists: boolean
	trackedRows?: number
	newest?: number
	tables?: string[]
	shape?: "array" | "rows"
	noTrackingTable?: boolean
}) {
	const tables = opts.tables ?? [
		"documents",
		"document_chunks",
		"document_revisions",
	]
	return {
		execute: (async (query: unknown) => {
			const text = JSON.stringify(query)
			let payload: Record<string, unknown>[]
			if (text.includes("to_regclass")) {
				payload = [{ regclass: opts.tableExists ? "documents" : null }]
			} else if (text.includes("pg_class")) {
				payload = tables.map((name) => ({ name }))
			} else {
				if (opts.noTrackingTable) {
					throw new Error(
						'relation "drizzle.__drizzle_migrations" does not exist',
					)
				}
				payload = [
					{
						n: String(opts.trackedRows ?? 0),
						newest: opts.newest === undefined ? null : String(opts.newest),
					},
				]
			}
			return opts.shape === "rows" ? { rows: payload } : payload
		}) as never,
	}
}

describe("the journal on disk", () => {
	test("is the squashed baseline plus one additive migration", () => {
		// Load-bearing: every "additive" case below reads 0001's real SQL. If the
		// chain is regenerated with a destructive migration in it, the additive
		// assertions must start failing rather than quietly passing.
		expect(BASELINE).toBe("0000_military_wolfpack")
		expect(ADDITIVE).toBeTruthy()
		expect(JOURNAL[1]?.when).toBeGreaterThan(JOURNAL[0]?.when ?? 0)
	})

	test("0001 creates only new tables and never alters the document tables", () => {
		const sql = readFileSync(
			new URL(`../drizzle/${ADDITIVE}.sql`, import.meta.url).pathname,
			"utf8",
		)
		expect(sql).not.toMatch(
			/ALTER TABLE\s+"(documents|document_chunks|document_revisions)"/,
		)
		expect(sql).not.toMatch(/\bDROP\b/)
		expect(sql).not.toMatch(/\bTRUNCATE\b/)
		expect(sql).not.toMatch(/search_vector|tsvector/)
	})
})

describe("assertMigrationTargetIsClean", () => {
	test("allows a fresh database (table absent)", async () => {
		const guard = await assertMigrationTargetIsClean(
			fakeDb({ tableExists: false }),
		)
		expect(guard.ok).toBe(true)
		// The WHOLE chain must be reported pending for a fresh database.
		// Reporting `[]` is what made `db:migrate` silently migrate nothing on an
		// empty database: the caller reads an empty list as "already up to date"
		// and skips migrate() entirely, leaving the schema uncreated.
		expect(guard.pending.length).toBeGreaterThan(0)
	})

	test("refuses a database whose schema was applied by hand", async () => {
		// The bare-array shape is what postgres-js returns. This is the case that
		// silently passed before: `.rows` on an array is undefined, so the guard
		// saw "no table" and waved the migration through.
		const guard = await assertMigrationTargetIsClean(
			fakeDb({ tableExists: true }),
		)
		expect(guard.ok).toBe(false)
		expect(guard.message).toMatch(/already exists/)
	})

	test("treats an absent tracking table as hand-applied, not as clean", async () => {
		const guard = await assertMigrationTargetIsClean(
			fakeDb({ tableExists: true, noTrackingTable: true }),
		)
		expect(guard.ok).toBe(false)
		expect(guard.message).toMatch(/no migration record/i)
	})

	test("ALLOWS an adopted database with an additive migration pending", async () => {
		// This is the case the rewrite exists for. An adopted database has the
		// document tables and a tracking row, which the previous guard refused
		// outright — blocking the ordinary adopt → migrate path entirely.
		const guard = await assertMigrationTargetIsClean(
			fakeDb({
				tableExists: true,
				trackedRows: 1,
				// Recorded state = the baseline's timestamp, so only 0001 is newer.
				newest: JOURNAL[0]?.when,
				tables: ["documents", "document_chunks", "document_revisions"],
			}),
		)
		expect(guard.ok).toBe(true)
		// Only the additive entry is pending; the baseline is already recorded.
		expect(guard.pending.map((e) => e.tag)).toEqual([ADDITIVE])
	})

	test("allows a database that is already fully up to date", async () => {
		const guard = await assertMigrationTargetIsClean(
			fakeDb({
				tableExists: true,
				trackedRows: 2,
				// Newest recorded row is at or past every journal entry, so drizzle
				// would run nothing.
				newest: Math.max(...JOURNAL.map((e) => e.when)) + 1,
				tables: [
					"documents",
					"document_chunks",
					"document_revisions",
					"user",
					"session",
					"account",
					"verification",
				],
			}),
		)
		expect(guard.ok).toBe(true)
		expect(guard.pending).toEqual([])
	})

	test("REFUSES when the pending batch would recreate an existing table", async () => {
		// A tracking row OLDER than the baseline, so the baseline is pending —
		// and the baseline CREATEs `documents`, which exists. This is the
		// pre-squash database the guard was built for.
		const guard = await assertMigrationTargetIsClean(
			fakeDb({
				tableExists: true,
				trackedRows: 3,
				newest: JOURNAL[0]?.when - 1,
			}),
		)
		expect(guard.ok).toBe(false)
		expect(guard.message).toMatch(/already exists/)
		expect(guard.message).toMatch(/db:migrate:adopt/)
	})

	test("REFUSES when the auth tables are already there but untracked", async () => {
		// Someone created the auth tables by hand, or with `drizzle-kit push`.
		// Replaying 0001 would fail on `CREATE TABLE "user"`, so the guard must
		// refuse rather than hand a duplicate-relation error to the operator.
		const guard = await assertMigrationTargetIsClean(
			fakeDb({
				tableExists: true,
				trackedRows: 1,
				newest: JOURNAL[0]?.when,
				tables: ["documents", "document_chunks", "document_revisions", "user"],
			}),
		)
		expect(guard.ok).toBe(false)
		expect(guard.message).toMatch(/user/)
	})

	test("also handles the node-postgres .rows shape", async () => {
		// Guards the fallback branch: if the driver is ever swapped, the guard
		// must not silently start passing everything again.
		const absent = await assertMigrationTargetIsClean(
			fakeDb({ tableExists: false, shape: "rows" }),
		)
		expect(absent.ok).toBe(true)

		const present = await assertMigrationTargetIsClean(
			fakeDb({ tableExists: true, shape: "rows" }),
		)
		expect(present.ok).toBe(false)
	})

	test("the remedy it recommends is a command that exists", async () => {
		const guard = await assertMigrationTargetIsClean(
			fakeDb({ tableExists: true }),
		)
		expect(guard.message).toMatch(/pnpm --filter @mcpedia\/db db:migrate:adopt/)
		// `--baseline` was the previous advice and does not exist in drizzle-kit
		// 0.31.11 (`migrate --help` lists only --config).
		expect(guard.message).not.toMatch(/--baseline/)
	})
})
