import type { DocumentMeta } from "@mcpedia/types"
import { describe, expect, it } from "vitest"
import {
	countUniqueTags,
	recentDocuments,
	sectionShare,
} from "./dashboard-data"

function doc(slug: string, tags: string[], updatedAt: string): DocumentMeta {
	return {
		id: slug,
		slug,
		title: slug,
		type: "doc",
		section: "docs",
		status: "published",
		author: "",
		tags,
		path: `${slug}.md`,
		createdAt: updatedAt,
		updatedAt,
	}
}

const DOCS = [
	doc("old", ["web"], "2026-01-01T00:00:00.000Z"),
	doc("newest", ["web", "pwn"], "2026-03-01T00:00:00.000Z"),
	doc("middle", ["web"], "2026-02-01T00:00:00.000Z"),
]

describe("countUniqueTags", () => {
	it("counts distinct tags, not occurrences", () => {
		expect(countUniqueTags(DOCS)).toBe(2)
	})

	it("is zero for an empty corpus", () => {
		expect(countUniqueTags([])).toBe(0)
	})
})

describe("recentDocuments", () => {
	it("sorts newest first", () => {
		expect(recentDocuments(DOCS).map((d) => d.slug)).toEqual([
			"newest",
			"middle",
			"old",
		])
	})

	it("caps at the limit", () => {
		expect(recentDocuments(DOCS, 2).map((d) => d.slug)).toEqual([
			"newest",
			"middle",
		])
	})

	it("does not mutate the caller's array", () => {
		// Array.prototype.sort mutates. The loader's array is also read by the
		// metric cards and the section breakdown, so an in-place sort would
		// reorder data another part of the page depends on.
		const input = [...DOCS]
		const before = input.map((d) => d.slug)
		recentDocuments(input, 8)
		expect(input.map((d) => d.slug)).toEqual(before)
	})

	it("puts unparseable timestamps last rather than throwing", () => {
		const withBad = [
			doc("good", [], "2026-01-01T00:00:00.000Z"),
			doc("bad", [], "not-a-date"),
		]
		const sorted = recentDocuments(withBad).map((d) => d.slug)
		expect(sorted[0]).toBe("good")
	})
})

describe("sectionShare", () => {
	it("computes a whole percentage", () => {
		expect(sectionShare(3, 12)).toBe(25)
	})

	it("rounds to the nearest whole percent", () => {
		expect(sectionShare(1, 3)).toBe(33)
		expect(sectionShare(2, 3)).toBe(67)
	})

	it("returns 0 rather than NaN when there are no documents", () => {
		// Math.round(0/0) is NaN, and React renders NaN as the literal text
		// "NaN" inside the progress bar. This guard is load-bearing.
		expect(sectionShare(5, 0)).toBe(0)
		expect(Number.isNaN(sectionShare(5, 0))).toBe(false)
	})
})
