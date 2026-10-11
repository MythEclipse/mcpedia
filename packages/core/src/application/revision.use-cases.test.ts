/**
 * Unit tests for the revision use cases, with faked collaborators.
 *
 * The numbering rule is the thing worth pinning. `revisionNo` is
 * `(latest ?? 0) + 1`, read per-document, and getting it wrong does not throw —
 * it produces a history with duplicate or interleaved numbers that nothing
 * validates, and the symptom only appears much later as a revision that cannot
 * be restored.
 */
import { describe, expect, test, vi } from "vitest"
import {
	makeSnapshotRevision,
	makeRestoreRevision,
	makeListRevisions,
	makeGetRevision,
} from "./revision.use-cases"
import type { DocumentMeta } from "../domain"

function doc(over: Partial<DocumentMeta> = {}): DocumentMeta {
	return {
		id: "docs/alpha",
		slug: "docs/alpha",
		title: "Alpha",
		type: "documentation",
		section: "docs",
		status: "published",
		author: "asepharyana",
		tags: ["pwn"],
		path: "docs/alpha.md",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		extraFields: {},
		...over,
	}
}

function fakeDeps() {
	return {
		revisions: {
			list: vi.fn(async () => []),
			getById: vi.fn(async () => null),
			getLatestBody: vi.fn(
				async () => null as null | { body: string; revisionNo: number },
			),
			insert: vi.fn(async () => {}),
			getDocumentRef: vi.fn(
				async () => null as null | { documentId: string; slug: string },
			),
		},
		documents: {
			getBySlug: vi.fn(async () => null as DocumentMeta | null),
			update: vi.fn(async () => {}),
		},
		index: { rebuild: vi.fn(async () => 3) },
		mirror: { write: vi.fn(async () => {}) },
		now: () => new Date("2026-02-03T04:05:06.000Z"),
	}
}

describe("makeSnapshotRevision", () => {
	test("the first snapshot of a document is revision 1", async () => {
		const deps = fakeDeps()
		const created = await makeSnapshotRevision(deps)(
			"docs/alpha",
			doc(),
			"body",
			"create",
		)
		expect(created).toBe(true)
		expect(deps.revisions.insert).toHaveBeenCalledWith(
			expect.objectContaining({ slug: "docs/alpha", revisionNo: 1 }),
		)
	})

	test("a changed body gets the next number, not a hardcoded one", async () => {
		// This is the case a literal "1" or "2" would silently break.
		const deps = fakeDeps()
		deps.revisions.getLatestBody.mockResolvedValue({
			body: "old",
			revisionNo: 7,
		})
		await makeSnapshotRevision(deps)("docs/alpha", doc(), "new", "update")
		expect(deps.revisions.insert).toHaveBeenCalledWith(
			expect.objectContaining({ revisionNo: 8 }),
		)
	})

	test("an unchanged body writes NO revision — the dedup guarantee", async () => {
		// Metadata-only edits must not bloat history. This is the invariant the
		// four shouldCreateRevision tests protect at the predicate level; here it
		// is pinned at the use-case level, where the predicate is actually used.
		const deps = fakeDeps()
		deps.revisions.getLatestBody.mockResolvedValue({
			body: "identical",
			revisionNo: 3,
		})
		const created = await makeSnapshotRevision(deps)(
			"docs/alpha",
			doc({ title: "New Title" }),
			"identical",
			"update",
		)
		expect(created).toBe(false)
		expect(deps.revisions.insert).not.toHaveBeenCalled()
	})

	test("the reason is carried through for provenance", async () => {
		const deps = fakeDeps()
		await makeSnapshotRevision(deps)("docs/alpha", doc(), "b", "git-push")
		expect(deps.revisions.insert).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "git-push" }),
		)
	})
})

describe("makeRestoreRevision", () => {
	test("writes the snapshot's metadata back, not the live row's", async () => {
		// The point of a restore is to return the document to how it WAS; a
		// document edited since then carries values the revision never had.
		const deps = fakeDeps()
		deps.revisions.getById.mockResolvedValue({
			id: "r1",
			revisionNo: 2,
			title: "Alpha (old title)",
			body: "old body",
			meta: {
				type: "writeup",
				section: "ctf",
				status: "draft",
				author: "someone-else",
				tags: ["web"],
			},
		})
		deps.revisions.getDocumentRef.mockResolvedValue({
			documentId: "d1",
			slug: "docs/alpha",
		})
		deps.documents.getBySlug.mockResolvedValue(
			doc({
				title: "Alpha (current title)",
				section: "docs",
				status: "published",
			}),
		)

		await makeRestoreRevision(deps)("r1")

		expect(deps.documents.update).toHaveBeenCalledWith(
			"docs/alpha",
			expect.objectContaining({
				title: "Alpha (old title)",
				section: "ctf",
				status: "draft",
				author: "someone-else",
				tags: ["web"],
			}),
			"old body",
		)
	})

	test("rebuilds chunks from the RESTORED body — otherwise search disagrees with the page", async () => {
		const deps = fakeDeps()
		deps.revisions.getById.mockResolvedValue({
			id: "r1",
			revisionNo: 1,
			title: "Alpha",
			body: "restored body",
			meta: {},
		})
		deps.revisions.getDocumentRef.mockResolvedValue({
			documentId: "d1",
			slug: "docs/alpha",
		})
		deps.documents.getBySlug.mockResolvedValue(doc())

		await makeRestoreRevision(deps)("r1")

		expect(deps.index.rebuild).toHaveBeenCalledWith("docs/alpha")
		const updateOrder = deps.documents.update.mock.invocationCallOrder[0]
		const rebuildOrder = deps.index.rebuild.mock.invocationCallOrder[0]
		expect(updateOrder).toBeLessThan(rebuildOrder)
	})

	test("returns null for a revision that does not exist", async () => {
		const deps = fakeDeps()
		deps.revisions.getById.mockResolvedValue(null)
		expect(await makeRestoreRevision(deps)("nope")).toBeNull()
		expect(deps.documents.update).not.toHaveBeenCalled()
	})

	test("a snapshot written by an older build still restores, via defaults", async () => {
		// `meta: {}` is what a pre-metadata snapshot looks like. It must degrade
		// to the documented defaults rather than crash.
		const deps = fakeDeps()
		deps.revisions.getById.mockResolvedValue({
			id: "r1",
			revisionNo: 1,
			title: "Alpha",
			body: "b",
			meta: {},
		})
		deps.revisions.getDocumentRef.mockResolvedValue({
			documentId: "d1",
			slug: "docs/alpha",
		})
		deps.documents.getBySlug.mockResolvedValue(doc())

		await makeRestoreRevision(deps)("r1")
		expect(deps.documents.update).toHaveBeenCalledWith(
			"docs/alpha",
			expect.objectContaining({
				type: "documentation",
				section: "docs",
				status: "published",
				author: "",
				tags: [],
			}),
			"b",
		)
	})

	test("a failed backup sync does not fail an already-committed restore", async () => {
		const deps = fakeDeps()
		deps.revisions.getById.mockResolvedValue({
			id: "r1",
			revisionNo: 1,
			title: "Alpha",
			body: "b",
			meta: {},
		})
		deps.revisions.getDocumentRef.mockResolvedValue({
			documentId: "d1",
			slug: "docs/alpha",
		})
		deps.documents.getBySlug.mockResolvedValue(doc())
		deps.mirror.write.mockRejectedValue(new Error("EACCES"))

		const res = await makeRestoreRevision(deps)("r1")
		expect(res).toEqual({ slug: "docs/alpha", documentId: "d1" })
		expect(deps.index.rebuild).toHaveBeenCalled()
	})
})

describe("revision reads", () => {
	test("listRevisions delegates with the caller's paging", async () => {
		const deps = fakeDeps()
		await makeListRevisions(deps)("docs/alpha", 50, 10)
		expect(deps.revisions.list).toHaveBeenCalledWith("docs/alpha", 50, 10)
	})

	test("listRevisions defaults to 20 from offset 0", async () => {
		const deps = fakeDeps()
		await makeListRevisions(deps)("docs/alpha")
		expect(deps.revisions.list).toHaveBeenCalledWith("docs/alpha", 20, 0)
	})

	test("getRevision delegates by id", async () => {
		const deps = fakeDeps()
		await makeGetRevision(deps)("r9")
		expect(deps.revisions.getById).toHaveBeenCalledWith("r9")
	})
})
