import { describe, expect, it } from "vitest"
import { qk } from "#/lib/queries"
import { tagOpacity } from "./TagCloud"

/**
 * Cache-key identity, for both former SWR keys.
 *
 * These were string-key assertions under SWR (`"orpc:queue/status"`, and
 * `orpc:tags:${limit}` interpolated). TanStack keys are structural arrays, so the
 * property that mattered — two observers of one resource share one entry — is
 * now expressed as deep equality on an array rather than as string equality. The
 * reasoning is unchanged; only the representation moved.
 */
describe("query keys", () => {
	it("shares one queue key across the badge and the strip", () => {
		// Two different keys would mean two independent pollers for the same five
		// integers, doubling requests and letting the two disagree on screen for
		// up to a refresh interval.
		expect(qk.queue).toEqual(["queue", "status"])
	})

	it("keys the tag cloud by limit", () => {
		// TagCloud renders at 30 in the header while the default is 24; a shared
		// key would let one render adopt the other's list.
		expect(qk.tags(24)).not.toEqual(qk.tags(30))
		expect(qk.tags(30)).toContain("30")
	})

	it("puts every tag key under the same 'tags' prefix", () => {
		// So one `invalidateQueries({ queryKey: ["tags"] })` clears all of them —
		// the reason the factory nests rather than emitting flat strings.
		expect(qk.tags(24)[0]).toBe(qk.tags(30)[0])
	})
})

describe("tagOpacity", () => {
	it("runs from 0.45 (rarest) to 1 (most common)", () => {
		// The Next component wrote 0.45 + intensity * 0.55; this pins the range
		// so a re-tune cannot silently wash the cloud out.
		expect(tagOpacity(5, 5)).toBeCloseTo(1)
		expect(tagOpacity(0, 5)).toBeCloseTo(0.45)
		expect(tagOpacity(2.5, 5)).toBeCloseTo(0.725)
	})

	it("stays finite at the low end", () => {
		expect(Number.isFinite(tagOpacity(1, 1))).toBe(true)
		expect(Number.isFinite(tagOpacity(0, 1))).toBe(true)
	})
})
