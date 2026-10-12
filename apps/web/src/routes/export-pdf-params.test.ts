import { describe, expect, it } from "vitest"
import {
	DEFAULT_SORT,
	isExportableDocument,
	parseSortOption,
	resolveExportRequest,
	SORT_OPTIONS,
} from "./export-pdf-params"

describe("parseSortOption", () => {
	it("accepts every supported sort mode", () => {
		for (const option of SORT_OPTIONS) {
			expect(parseSortOption(option)).toBe(option)
		}
	})

	it("falls back rather than passing junk to the API", () => {
		// ?sort is user-controlled. ExportInput's zod enum would reject this and
		// 422 the whole page; falling back keeps a hand-edited URL working.
		expect(parseSortOption(undefined)).toBe(DEFAULT_SORT)
		expect(parseSortOption("")).toBe(DEFAULT_SORT)
		expect(parseSortOption("nonsense")).toBe(DEFAULT_SORT)
		expect(parseSortOption("title; DROP TABLE")).toBe(DEFAULT_SORT)
	})
})

describe("resolveExportRequest", () => {
	it("treats path and slug as aliases, with path winning", () => {
		// Both names are already in the wild: the slug page links here with
		// either. Precedence is ported verbatim from the Next page.
		expect(resolveExportRequest({ path: "a/b", slug: "c/d" }).path).toBe("a/b")
		expect(resolveExportRequest({ slug: "c/d" }).path).toBe("c/d")
	})

	it("uses section only when there is no path", () => {
		// core resolves a path against every section, so sending both would
		// narrow a result set that is supposed to be global.
		const withPath = resolveExportRequest({ path: "ctf/web", section: "docs" })
		expect(withPath.path).toBe("ctf/web")
		expect(withPath.section).toBeUndefined()

		const withoutPath = resolveExportRequest({ section: "docs" })
		expect(withoutPath.path).toBeUndefined()
		expect(withoutPath.section).toBe("docs")
	})

	it("strips surrounding slashes so the request and the back link agree", () => {
		const r = resolveExportRequest({ path: "/ctf/web/" })
		expect(r.path).toBe("ctf/web")
		expect(r.backHref).toBe("/ctf/web")
	})

	it("treats a slashes-only path as absent", () => {
		const r = resolveExportRequest({ path: "///" })
		expect(r.path).toBeUndefined()
	})

	it("builds a back link that matches the scope", () => {
		expect(resolveExportRequest({ path: "ctf/web" }).backHref).toBe("/ctf/web")
		expect(resolveExportRequest({ section: "docs" }).backHref).toBe("/docs")
		expect(resolveExportRequest({}).backHref).toBe("/")
	})

	it("names the scope it searched, for the empty state", () => {
		expect(resolveExportRequest({ path: "ctf/web" }).scopeLabel).toBe("ctf/web")
		expect(resolveExportRequest({ section: "docs" }).scopeLabel).toBe("docs")
		expect(resolveExportRequest({}).scopeLabel).toBe("root")
	})

	it("passes the sort through, defaulting to category_points", () => {
		expect(resolveExportRequest({ sort: "title" }).sortBy).toBe("title")
		expect(resolveExportRequest({}).sortBy).toBe(DEFAULT_SORT)
	})

	it("never emits an explicit undefined key", () => {
		// Every ExportInput field is zod `.optional()`, which rejects null. The
		// payload is built by conditional spread so no undefined key can appear.
		const r = resolveExportRequest({ section: "docs" })
		expect("path" in r).toBe(false)
		expect(Object.keys(r).sort()).toEqual([
			"backHref",
			"scopeLabel",
			"section",
			"sortBy",
		])
	})
})

describe("isExportableDocument", () => {
	it("drops index and meta files", () => {
		// core keeps a lone `index` on purpose; the view applies the stricter
		// filter so a single-index export renders the empty state instead of a
		// table of contents for one document nobody asked for.
		expect(isExportableDocument({ slug: "ctf/web/index" })).toBe(false)
		expect(isExportableDocument({ slug: "ctf/web/_index" })).toBe(false)
		expect(isExportableDocument({ slug: "index" })).toBe(false)
		expect(isExportableDocument({ slug: "INDEX" })).toBe(false)
		expect(
			isExportableDocument({ slug: "ctf/web/chall-1", type: "writeup-index" }),
		).toBe(false)
	})

	it("keeps real documents", () => {
		expect(isExportableDocument({ slug: "ctf/web/chall-1" })).toBe(true)
		// "indexing" merely CONTAINS "index" — a suffix check, not a substring.
		expect(isExportableDocument({ slug: "docs/indexing" })).toBe(true)
		expect(isExportableDocument({ slug: "docs/reindex" })).toBe(true)
	})
})
