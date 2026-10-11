import { describe, expect, it } from "vitest"
import { QUEUE_STATUS_KEY } from "./QueueBadge"
import { tagCloudKey, tagOpacity } from "./TagCloud"

describe("SWR cache keys", () => {
	it("shares one queue key across the badge and the strip", () => {
		// Two different keys would mean two independent pollers for the same
		// five integers, doubling requests and letting the two disagree on
		// screen for up to a refresh interval.
		expect(QUEUE_STATUS_KEY).toBe("orpc:queue/status")
	})

	it("keys the tag cloud by limit", () => {
		// TagCloudClient renders at 30 while the default is 24; a shared key
		// would let one render adopt the other's list.
		expect(tagCloudKey(24)).not.toBe(tagCloudKey(30))
		expect(tagCloudKey(30)).toContain("30")
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
