/**
 * Unit tests for the read use cases, with faked collaborators.
 *
 * `makeFolderInfo` is the one with real logic: it combines a live document list
 * with the pure path predicates, and the combination is what lets a slug page
 * choose between rendering, listing and 404ing.
 */
import { describe, expect, test, vi } from "vitest"
import type { DocumentMeta, SectionRecord } from "../domain"
import {
	makeFolderInfo,
	makeGetRelated,
	makeListDocuments,
	makeListSections,
	type SectionReadDeps,
} from "./read.use-cases"

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
	const documents = {
		list: vi.fn(async () => slugs.map(doc)),
		getBySlug: vi.fn(async () => null),
		getRelated: vi.fn(async () => [] as DocumentMeta[]),
		listSections: vi.fn(
			async (): Promise<
				Array<{ section: string; count: number; latestUpdate: string }>
			> => [],
		),
		// Empty by default: a database with no registry rows is exactly the
		// state the old hardcoded fallback was hiding, so most tests below
		// exercise the unregistered path. Tests that need curation set it.
		listRegistry: vi.fn(async () => [] as SectionRecord[]),
	}
	// Typed against the port so a fake that drifts from the real repository
	// fails to compile here rather than silently satisfying a narrower shape.
	return { documents } satisfies SectionReadDeps
}

/** A registry row, with the fields the reader does not care about defaulted. */
function record(id: string, over: Partial<SectionRecord> = {}): SectionRecord {
	return {
		id,
		label: id,
		icon: "📁",
		desc: "",
		sortOrder: 1000,
		hidden: false,
		...over,
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
	test("an EMPTY registry yields nothing — sections come from the table, not code", async () => {
		// This is the behaviour change. It used to answer with four hardcoded
		// sections so a fresh install looked navigable, which meant the header
		// advertised sections no document could belong to and could not reflect
		// a rename. Section metadata is content now: with no rows, there are no
		// sections, and the seed (not this use case) is what populates a fresh
		// database.
		const deps = fakeRepo()
		const sections = await makeListSections(deps)()
		expect(sections).toEqual([])
	})

	test("reports a registered section at zero documents", async () => {
		// The property the old fallback existed for, now served from the table:
		// a configured-but-empty section is listed with docCount 0, so it is
		// visitable before anyone writes to it.
		const deps = fakeRepo()
		deps.documents.listRegistry.mockResolvedValue([
			record("docs", { label: "Documentation", icon: "📄", sortOrder: 0 }),
		])
		const sections = await makeListSections(deps)()
		expect(sections).toHaveLength(1)
		expect(sections[0]).toMatchObject({
			id: "docs",
			label: "Documentation",
			icon: "📄",
			docCount: 0,
		})
	})

	test("uses the registered label, not a derived one", async () => {
		// The whole point of the table: a curated name wins over title-casing.
		const deps = fakeRepo()
		deps.documents.listSections.mockResolvedValue([
			{ section: "writeups", count: 3, latestUpdate: "2026-02-01T00:00:00Z" },
		])
		deps.documents.listRegistry.mockResolvedValue([
			record("writeups", { label: "Post-Mortems", sortOrder: 1 }),
		])
		const sections = await makeListSections(deps)()
		expect(sections[0]?.label).toBe("Post-Mortems")
		expect(sections[0]?.docCount).toBe(3)
		expect(sections[0]?.updatedAt).toBe("2026-02-01T00:00:00Z")
	})

	test("keeps a section that has documents but no registry row", async () => {
		// A document created through MCP in an ad-hoc section must stay
		// reachable. Dropping it from the list would hide the document from the
		// only navigation that exists.
		const deps = fakeRepo()
		deps.documents.listSections.mockResolvedValue([
			{ section: "ctf", count: 12, latestUpdate: "2026-02-01T00:00:00Z" },
		])
		const sections = await makeListSections(deps)()
		expect(sections).toHaveLength(1)
		expect(sections[0]?.id).toBe("ctf")
		expect(sections[0]?.label).toBe("Ctf")
		expect(sections[0]?.docCount).toBe(12)
	})

	test("orders by registry position, then unregistered ids alphabetically", async () => {
		// Registry order is an editorial decision; the tail is sorted so the nav
		// does not visibly reshuffle between reads.
		const deps = fakeRepo()
		deps.documents.listSections.mockResolvedValue([
			{ section: "zeta", count: 1, latestUpdate: "" },
			{ section: "alpha", count: 1, latestUpdate: "" },
			{ section: "docs", count: 5, latestUpdate: "" },
		])
		deps.documents.listRegistry.mockResolvedValue([
			record("docs", { label: "Documentation", sortOrder: 0 }),
		])
		const sections = await makeListSections(deps)()
		expect(sections.map((s) => s.id)).toEqual(["docs", "alpha", "zeta"])
	})

	test("omits hidden sections from the list but leaves their documents alone", async () => {
		// Hidden is "unlisted", not "deleted": the header nav drops it, and the
		// documents are still readable at their own URL.
		const deps = fakeRepo()
		deps.documents.listSections.mockResolvedValue([
			{ section: "docs", count: 2, latestUpdate: "" },
			{ section: "secret", count: 7, latestUpdate: "" },
		])
		deps.documents.listRegistry.mockResolvedValue([
			record("docs", { sortOrder: 0 }),
			record("secret", { sortOrder: 1, hidden: true }),
		])
		const sections = await makeListSections(deps)()
		expect(sections.map((s) => s.id)).toEqual(["docs"])
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
