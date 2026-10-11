import { describe, expect, test } from "vitest"
import { assertMigrationTargetIsClean } from "./migrate-guard"

/**
 * The guard shipped broken once: `firstRow()` read `result.rows`, but drizzle's
 * postgres-js driver returns a BARE ARRAY, so `.rows` was always undefined and
 * every database looked clean. It typechecked, it ran, it printed a reassuring
 * message — and it never refused anything.
 *
 * A guard's only observable behaviour is the case where it says no, so these
 * tests exercise exactly that, against the real result shapes drizzle returns.
 */

/**
 * A stand-in db that answers by query text: `to_regclass` for the table check,
 * a tracking count for the second query. The guard issues exactly two queries,
 * so a single-response mock would feed one result into both reads.
 */
function fakeDb(opts: {
	tableExists: boolean
	trackedRows?: number
	shape?: "array" | "rows"
	noTrackingTable?: boolean
}) {
	return {
		execute: (async (query: unknown) => {
			const text = JSON.stringify(query)
			const isTableCheck = text.includes("to_regclass")
			let payload: Record<string, unknown>[]
			if (isTableCheck) {
				payload = opts.tableExists
					? [{ regclass: "documents" }]
					: [{ regclass: null }]
			} else {
				if (opts.noTrackingTable) {
					throw new Error(
						'relation "drizzle.__drizzle_migrations" does not exist',
					)
				}
				payload = [{ n: String(opts.trackedRows ?? 0) }]
			}
			return opts.shape === "rows" ? { rows: payload } : payload
		}) as never,
	}
}

describe("assertMigrationTargetIsClean", () => {
	test("allows a fresh database (table absent)", async () => {
		const guard = await assertMigrationTargetIsClean(
			fakeDb({ tableExists: false }),
		)
		expect(guard.ok).toBe(true)
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

	test("refuses when drizzle IS tracking, from the pre-squash history", async () => {
		const guard = await assertMigrationTargetIsClean(
			fakeDb({ tableExists: true, trackedRows: 3 }),
		)
		expect(guard.ok).toBe(false)
		expect(guard.message).toMatch(/3\s+migration\(s\)/)
		expect(guard.message).toMatch(/db:migrate:adopt/)
	})

	test("treats an absent tracking table as hand-applied, not as clean", async () => {
		const guard = await assertMigrationTargetIsClean(
			fakeDb({ tableExists: true, noTrackingTable: true }),
		)
		expect(guard.ok).toBe(false)
		expect(guard.message).toMatch(/no migration record/i)
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
