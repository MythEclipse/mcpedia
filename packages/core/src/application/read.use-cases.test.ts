/**
 * Unit tests for the read use cases, with faked collaborators.
 *
 * `makeFolderInfo` is the one with real logic: it combines a live document list
 * with the pure path predicates, and the combination is what lets a slug page
 * choose between rendering, listing and 404ing.
 */
import { describe, expect, test, vi } from "vitest"
import {
	makeFolderInfo,
	makeListDocuments,
	makeListSections,
	makeGetRelated,
} from "./read.use-cases"
import type { DocumentMeta } from "../domain"

function doc(slug: string): DocumentMeta {
	return {
		id: slug,
		slug,
		title: slug,
		type: "documentation",
		section: slug.split("/")[0] ?? "docs",
		status: "published",
		author: "",
		tags: [],
		path: `${slug}.md`,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		extraFields: {},
	}
}

function fakeRepo(slugs: string[] = []) {
	return {
		documents: {
			list: vi.fn(async () => slugs.map(doc)),
			getBySlug: vi.fn(async () => null),
			getRelated: vi.fn(async () => []),
			listSections: vi.fn(async () => []),
		},
	}
}

describe("makeFolderInfo", () => {
	test("classifies a leaf document as 'doc'", async () => {
		const deps = fakeRepo(["docs/a", "docs/b/c"])
		const info = await makeFolderInfo(deps)("docs", "docs/a")
		expect(info.classification).toBe("doc")
		expect(info.docCount).toBe(2)
	})

	test("classifies a parent path as 'folder'", async () => {
		const deps = fakeRepo(["docs/b/c"])
		expect((await makeFolderInfo(deps)("docs", "docs/b")).classification).toBe(
			"folder",
		)
	})

	test("classifies an unknown path as 'none' — the page will 404", async () => {
		const deps = fakeRepo(["docs/a"])
		expect((await makeFolderInfo(deps)("docs", "docs/zz")).classification).toBe(
			"none",
		)
	})

	test("the folder tree is section-scoped", async () => {
		// A slug in another section must not leak into this section's tree.
		const deps = fakeRepo(["docs/b/c", "ctf/d/e"])
		const info = await makeFolderInfo(deps)("docs", "docs/b/c")
		expect(info.folders).toEqual(["b"])
	})

	test("both answers come from ONE list read", async () => {
		// Two reads could disagree: a document created between them would make
		// the classification say "none" while the tree still shows its parent.
		const deps = fakeRepo(["docs/a"])
		await makeFolderInfo(deps)("docs", "docs/a")
		expect(deps.documents.list).toHaveBeenCalledTimes(1)
		expect(deps.documents.list).toHaveBeenCalledWith({ section: "docs" })
	})
})

describe("makeListSections", () => {
	test("an empty corpus falls back to the preset sections at zero", async () => {
		// A fresh install must still be navigable: the API answers with the
		// presets so a section that does not exist yet can be visited.
		const deps = fakeRepo()
		const sections = await makeListSections(deps)()
		expect(sections.length).toBeGreaterThan(0)
		expect(sections.every((s) => s.docCount === 0)).toBe(true)
	})

	test("a populated corpus reports real counts", async () => {
		const deps = fakeRepo()
		deps.documents.listSections.mockResolvedValue([
			{ section: "ctf", count: 12, latestUpdate: "2026-02-01T00:00:00Z" },
		])
		const sections = await makeListSections(deps)()
		expect(sections[0]?.docCount).toBe(12)
		expect(sections[0]?.id).toBe("ctf")
		expect(sections[0]?.updatedAt).toBe("2026-02-01T00:00:00Z")
	})
})

describe("makeListDocuments / makeGetRelated", () => {
	test("listDocuments defaults to no filter", async () => {
		const deps = fakeRepo(["docs/a"])
		await makeListDocuments(deps)({})
		expect(deps.documents.list).toHaveBeenCalledWith({})
	})

	test("listDocuments forwards a section filter", async () => {
		const deps = fakeRepo(["docs/a"])
		await makeListDocuments(deps)({ section: "docs" })
		expect(deps.documents.list).toHaveBeenCalledWith({ section: "docs" })
	})

	test("getRelated defaults to a limit of 5", async () => {
		const deps = fakeRepo()
		await makeGetRelated(deps)("docs/a")
		expect(deps.documents.getRelated).toHaveBeenCalledWith("docs/a", 5)
	})
})
