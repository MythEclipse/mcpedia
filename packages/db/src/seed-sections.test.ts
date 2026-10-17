import { describe, expect, test } from "vitest"
import { SECTION_SEED, seedSections } from "./seed-sections"

/**
 * The seed's contract is IDEMPOTENCE, and that is the only property worth
 * testing here.
 *
 * Section names are now content an operator can rename through the API or MCP.
 * The seed runs on every `db:migrate` — including every deploy — so a seed that
 * wrote unconditionally would silently revert a curated label on the next
 * release, and the symptom (a section quietly calling itself "Writeups" again)
 * has no error attached to it. `ON CONFLICT DO NOTHING` is what prevents that,
 * which is why the assertion is on the conflict clause rather than the row
 * contents.
 *
 * A fake database is used rather than a real Postgres because the property is
 * about the QUERY SHAPE sql the seed builds, not about Postgres's behaviour —
 * and the repo's unit tests do not stand up a database.
 */

/** A minimal stand-in that records the conflict target each insert declared. */
function fakeDb(existing: Set<string>) {
	const inserted: string[] = []
	const calls: Array<{ id: string; onConflict: unknown }> = []
	return {
		inserted,
		calls,
		db: {
			insert: () => ({
				values: (v: { id: string }) => ({
					onConflictDoNothing: (opts: unknown) => {
						calls.push({ id: v.id, onConflict: opts })
						return {
							returning: async () => {
								// Mirrors ON CONFLICT DO NOTHING: an existing id
								// returns no row, a new one returns itself.
								if (existing.has(v.id)) return []
								existing.add(v.id)
								inserted.push(v.id)
								return [{ id: v.id }]
							},
						}
					},
				}),
			}),
		},
	}
}

describe("seedSections", () => {
	test("inserts every seeded section on an empty registry", async () => {
		const { db, inserted } = fakeDb(new Set())
		const result = await seedSections(db as never)
		expect(result).toHaveLength(SECTION_SEED.length)
		expect(inserted).toEqual(SECTION_SEED.map((s) => s.id))
	})

	test("re-running inserts NOTHING — an operator's rename survives", async () => {
		// THE property. First run seeds, second run must be a no-op. If this
		// regresses, every deploy reverts curated labels with no error.
		const existing = new Set<string>()
		const first = fakeDb(existing)
		await seedSections(first.db as never)
		expect(first.inserted).toHaveLength(SECTION_SEED.length)

		const second = fakeDb(existing)
		const result = await seedSections(second.db as never)
		expect(result).toEqual([])
		expect(second.inserted).toEqual([])
	})

	test("every insert declares `id` as its conflict target, not another column", async () => {
		// Guards against the conflict clause being dropped OR pointed at the
		// wrong column in a refactor. Targeted at `id`, duplicates no-op; aimed
		// anywhere else, the second run throws on the primary key instead of
		// no-opping, turning a routine deploy into a failed migration.
		//
		// The target is compared by COLUMN NAME rather than by identity because
		// drizzle hands back the column object this module imported — comparing
		// identity would pass for any column of the same table.
		const { db, calls } = fakeDb(new Set())
		await seedSections(db as never)
		expect(calls).toHaveLength(SECTION_SEED.length)
		for (const call of calls) {
			const target = (call.onConflict as { target?: { name?: string } })?.target
			expect(target, `conflict target for ${call.id}`).toBeDefined()
			expect(target?.name, `conflict target column for ${call.id}`).toBe("id")
		}
	})

	test("seeds only ids the app already knew about", async () => {
		// A sanity check on the data itself: the seed exists to preserve the
		// names the site shipped with, not to introduce new sections.
		const ids = SECTION_SEED.map((s) => s.id)
		expect(new Set(ids).size).toBe(ids.length)
		for (const s of SECTION_SEED) {
			expect(s.label, `label for ${s.id}`).toBeTruthy()
			expect(s.icon, `icon for ${s.id}`).toBeTruthy()
		}
		// The four that were the header nav must be present.
		for (const id of ["docs", "writeups", "research", "notes"]) {
			expect(ids).toContain(id)
		}
	})

	test("order in the array is the nav order", async () => {
		// sortOrder is assigned from the array index, so the array IS the
		// ordering. Pinned because a reorder silently reshuffles the header.
		const { db } = fakeDb(new Set())
		const seen: Array<{ id: string; order: number }> = []
		const recording = {
			insert: () => ({
				values: (v: { id: string; sortOrder: number }) => ({
					onConflictDoNothing: () => ({
						returning: async () => {
							seen.push({ id: v.id, order: v.sortOrder })
							return [{ id: v.id }]
						},
					}),
				}),
			}),
		}
		await seedSections(recording as never)
		expect(seen.map((s) => s.id)).toEqual(SECTION_SEED.map((s) => s.id))
		expect(seen.map((s) => s.order)).toEqual(SECTION_SEED.map((_, i) => i))
		expect(db).toBeDefined()
	})
})
