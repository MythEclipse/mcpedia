import { describe, expect, test } from "vitest"
import { splitSlug } from "./DocLink"

/**
 * splitSlug decides which of two distinct routes a slug link targets:
 * /$section for a one-segment slug, /$section/$ for anything deeper.
 *
 * Getting this wrong is invisible in review and produces a real navigation bug
 * — a bare section sent to the splat route leaves SectionPage's active-row
 * logic reading a pathname it never sees. So the boundary cases are pinned.
 */
describe("splitSlug", () => {
	test("a one-segment slug has no splat, so it targets the section index", () => {
		expect(splitSlug("docs")).toEqual({ section: "docs", splat: undefined })
		expect(splitSlug("ctf")).toEqual({ section: "ctf", splat: undefined })
	})

	test("a deep slug splits into section and remainder", () => {
		expect(splitSlug("docs/setup/install")).toEqual({
			section: "docs",
			splat: "setup/install",
		})
	})

	test("a two-segment slug has a single-segment splat", () => {
		expect(splitSlug("docs/intro")).toEqual({
			section: "docs",
			splat: "intro",
		})
	})

	test("an export suffix is part of the splat, not stripped", () => {
		// The route that receives it decides what to do with it; splitting the
		// path apart here would hide the suffix from isExportPath.
		expect(splitSlug("docs/setup/export")).toEqual({
			section: "docs",
			splat: "setup/export",
		})
		expect(splitSlug("docs/export")).toEqual({
			section: "docs",
			splat: "export",
		})
	})

	test("ignores leading, trailing and duplicate slashes", () => {
		expect(splitSlug("/docs/setup/")).toEqual({
			section: "docs",
			splat: "setup",
		})
		expect(splitSlug("docs//setup")).toEqual({
			section: "docs",
			splat: "setup",
		})
	})

	test("an empty slug falls back to docs rather than crashing", () => {
		expect(splitSlug("")).toEqual({ section: "docs", splat: undefined })
		expect(splitSlug("/")).toEqual({ section: "docs", splat: undefined })
		expect(splitSlug("///")).toEqual({ section: "docs", splat: undefined })
	})

	test("deeply nested slugs keep every segment", () => {
		expect(splitSlug("a/b/c/d/e/f")).toEqual({
			section: "a",
			splat: "b/c/d/e/f",
		})
	})
})
