/**
 * Tests for the pure domain path logic.
 *
 * `validateSlug` in particular is a security boundary — it is what stops
 * `../../etc/passwd` from reaching `slugToRelPath` and becoming a real path
 * under CONTENT_ROOT. Its cases are enumerated here rather than left to the
 * use-case tests because the traversal cases must hold regardless of which
 * caller reaches them.
 */
import { describe, expect, test } from "vitest"
import {
	classifyPath,
	extractFoldersForSection,
	slugToRelPath,
	validateSlug,
} from "./path"

describe("validateSlug", () => {
	test("accepts ordinary slugs and nested paths", () => {
		expect(validateSlug("docs/websocket/contract")).toBe(
			"docs/websocket/contract",
		)
		expect(validateSlug("notes/a")).toBe("notes/a")
		expect(validateSlug("a")).toBe("a")
		expect(validateSlug("with_underscore-and-dash")).toBe(
			"with_underscore-and-dash",
		)
		expect(validateSlug("nested/path/deep")).toBe("nested/path/deep")
	})

	test("rejects anything that could escape the content root", () => {
		// The traversal cases. Each of these would become a file OUTSIDE
		// CONTENT_ROOT if it reached slugToRelPath.
		expect(() => validateSlug("../etc/passwd")).toThrow(/invalid slug/)
		expect(() => validateSlug("docs/../../etc/passwd")).toThrow(/invalid slug/)
		expect(() => validateSlug("..")).toThrow(/invalid slug/)
		expect(() => validateSlug("/etc/passwd")).toThrow(/invalid slug/)
	})

	test("rejects characters that are not [a-z0-9/_-]", () => {
		expect(() => validateSlug("Docs/Upper")).toThrow(/invalid slug/)
		expect(() => validateSlug("with space")).toThrow(/invalid slug/)
		expect(() => validateSlug("emoji-🚀")).toThrow(/invalid slug/)
		expect(() => validateSlug("null\x00byte")).toThrow(/invalid slug/)
		expect(() => validateSlug("")).toThrow(/invalid slug/)
	})

	test("rejects a slug that does not start with an alphanumeric", () => {
		// A leading "-" or "/" would produce a path that is not a valid child.
		expect(() => validateSlug("-leading-dash")).toThrow(/invalid slug/)
		expect(() => validateSlug("/leading-slash")).toThrow(/invalid slug/)
		expect(() => validateSlug("_leading-underscore")).toThrow(/invalid slug/)
	})

	test("rejects a double slash, which would create an empty path segment", () => {
		expect(() => validateSlug("docs//double")).toThrow(/double slash/)
	})
})

describe("slugToRelPath", () => {
	test("puts the file under its section", () => {
		expect(slugToRelPath("docs", "docs/alpha")).toBe("docs/alpha.md")
	})

	test("does NOT double the section prefix", () => {
		// A slug that already carries its section must not become
		// "docs/docs/alpha.md".
		expect(slugToRelPath("docs", "docs/alpha")).toBe("docs/alpha.md")
		expect(slugToRelPath("docs", "alpha")).toBe("docs/alpha.md")
	})

	test("prefix-matches only on a whole segment", () => {
		// "docs" is a section prefix of "docsomething/x" by string comparison,
		// but not by segment. The trailing-slash test is what makes them differ.
		expect(slugToRelPath("docs", "docsomething/x")).toBe(
			"docs/docsomething/x.md",
		)
	})

	test("propagates slug validation", () => {
		expect(() => slugToRelPath("docs", "../escape")).toThrow(/invalid slug/)
	})
})

describe("extractFoldersForSection", () => {
	test("returns every ANCESTOR of a leaf, sorted", () => {
		// `docs/b/c` is a leaf, so it contributes "b" — not "b/c". Only
		// intermediate paths are folders; a slug that is itself a document is
		// not one of them.
		expect(
			extractFoldersForSection(
				["docs/a", "docs/b/c", "docs/b/d", "docs/e/f/g"],
				"docs",
			),
		).toEqual(["b", "e", "e/f"])
	})

	test("ignores slugs from other sections", () => {
		expect(
			extractFoldersForSection(["ctf/2026/warmup", "docs/a"], "docs"),
		).toEqual([])
	})

	test("tolerates .md suffixes", () => {
		expect(extractFoldersForSection(["docs/b/c.md"], "docs")).toEqual(["b"])
	})

	test("a leaf document contributes no folders", () => {
		expect(extractFoldersForSection(["docs/alpha"], "docs")).toEqual([])
	})

	test("an empty slug list yields no folders", () => {
		expect(extractFoldersForSection([], "docs")).toEqual([])
	})
})

describe("classifyPath", () => {
	const slugs = ["docs/alpha", "docs/b/c"]

	test("an exact slug is a document", () => {
		expect(classifyPath(slugs, "docs/alpha")).toBe("doc")
		expect(classifyPath(slugs, "docs/alpha.md")).toBe("doc")
	})

	test("a parent of a slug is a folder", () => {
		expect(classifyPath(slugs, "docs/b")).toBe("folder")
		expect(classifyPath(slugs, "docs")).toBe("folder")
	})

	test("anything else is none", () => {
		expect(classifyPath(slugs, "docs/zz")).toBe("none")
		expect(classifyPath(slugs, "ctf/x")).toBe("none")
		expect(classifyPath(slugs, "")).toBe("none")
	})
})
