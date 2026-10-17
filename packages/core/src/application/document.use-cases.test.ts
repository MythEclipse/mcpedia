/**
 * Unit tests for the document use cases, with faked collaborators.
 *
 * ## WHY THESE EXIST
 *
 * `createDocument`, `updateDocument` and `deleteDocument` used to be
 * module-level functions that imported `db` directly. There was no way to test
 * them without a live Postgres, so they had none — and they contain the only
 * interesting logic in the write path: the ORDER of operations, and the rule
 * that an indexing failure or a disk failure must degrade rather than roll back
 * a committed row.
 *
 * Both of those are now testable because the use cases are built by factories.
 * Every test here supplies an object of `vi.fn()`s, so the suite runs in
 * milliseconds with no database, no Redis and no filesystem.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import type {
	DocumentMeta,
	DocumentRepository,
	RevisionRepository,
} from "../domain"
import {
	makeCreateDocument,
	makeDeleteDocument,
	makeUpdateDocument,
} from "./document.use-cases"
import { makeGetDocument } from "./read.use-cases"

/** A stored document, as a repository would return it. */
function doc(over: Partial<DocumentMeta> = {}): DocumentMeta {
	return {
		id: "docs/alpha",
		slug: "docs/alpha",
		title: "Alpha",
		type: "documentation",
		section: "docs",
		status: "published",
		author: "",
		tags: [],
		path: "docs/alpha.md",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		extraFields: {},
		...over,
	}
}

function fakeDeps() {
	return {
		documents: {
			getBySlug: vi.fn(async () => null as DocumentMeta | null),
			insert: vi.fn(async () => {}),
			update: vi.fn(async () => {}),
			remove: vi.fn(async () => ({ deleted: true })),
			list: vi.fn(async () => [] as DocumentMeta[]),
			getRelated: vi.fn(async () => [] as DocumentMeta[]),
			listSections: vi.fn(async () => []),
			upsertFromFile: vi.fn(async () => {}),
			listForExport: vi.fn(async () => []),
			readContentFile: vi.fn(async () => ""),
			listContentFiles: vi.fn(async () => [] as string[]),
		} satisfies DocumentRepository,
		revisions: {
			list: vi.fn(async () => []),
			getById: vi.fn(async () => null),
			getLatestBody: vi.fn(
				async () => null as { body: string; revisionNo: number } | null,
			),
			insert: vi.fn(async () => {}),
			getDocumentRef: vi.fn(async () => null),
		} satisfies RevisionRepository,
		index: {
			chunkAndEmbed: vi.fn(async () => 2),
			rebuild: vi.fn(async () => 2),
			forget: vi.fn(async () => {}),
		},
		mirror: {
			write: vi.fn(async () => {}),
			remove: vi.fn(async () => true),
			read: vi.fn(async () => ""),
		},
		now: () => new Date("2026-02-03T04:05:06.000Z"),
	}
}

type Deps = ReturnType<typeof fakeDeps>

describe("makeCreateDocument", () => {
	let deps: Deps
	beforeEach(() => {
		deps = fakeDeps()
	})

	test("writes the row, snapshots a revision, indexes and mirrors — in that order", async () => {
		const order: string[] = []
		deps.documents.insert.mockImplementation(async () => {
			order.push("insert")
		})
		deps.revisions.insert.mockImplementation(async () => {
			order.push("revision")
		})
		deps.index.chunkAndEmbed.mockImplementation(async () => {
			order.push("index")
			return 2
		})
		deps.mirror.write.mockImplementation(async () => {
			order.push("mirror")
		})

		const meta = await makeCreateDocument(deps)({
			slug: "docs/alpha",
			title: "Alpha",
			section: "docs",
			body: "# Alpha",
		})

		expect(order).toEqual(["insert", "revision", "index", "mirror"])
		expect(meta.slug).toBe("docs/alpha")
		expect(meta.path).toBe("docs/alpha.md")
		expect(meta.updatedAt).toBe("2026-02-03T04:05:06.000Z")
	})

	test("the revision is snapshotted before indexing, so history cannot record an unindexed write", async () => {
		// The original order is load-bearing: a revision taken after a failed
		// index would describe a document whose chunks never existed.
		await makeCreateDocument(deps)({
			slug: "docs/alpha",
			title: "Alpha",
			section: "docs",
			body: "body",
		})
		const revisionOrder = deps.revisions.insert.mock.invocationCallOrder[0]
		const indexOrder = deps.index.chunkAndEmbed.mock.invocationCallOrder[0]
		expect(revisionOrder).toBeLessThan(indexOrder)
	})

	test("refuses a duplicate slug without writing anything", async () => {
		deps.documents.getBySlug.mockResolvedValue(doc())
		await expect(
			makeCreateDocument(deps)({
				slug: "docs/alpha",
				title: "Alpha",
				section: "docs",
				body: "x",
			}),
		).rejects.toThrow(/already exists/)
		expect(deps.documents.insert).not.toHaveBeenCalled()
		expect(deps.revisions.insert).not.toHaveBeenCalled()
	})

	test("an indexing failure does NOT roll back the committed row", async () => {
		// The central policy: FTS still works without embeddings, so a provider
		// outage must degrade the document, never lose it.
		deps.index.chunkAndEmbed.mockRejectedValue(new Error("provider down"))
		const meta = await makeCreateDocument(deps)({
			slug: "docs/alpha",
			title: "Alpha",
			section: "docs",
			body: "body",
		})
		expect(meta.slug).toBe("docs/alpha")
		expect(deps.documents.insert).toHaveBeenCalled()
		expect(deps.revisions.insert).toHaveBeenCalled()
	})

	test("a disk failure does not fail the write — the database is the source of truth", async () => {
		deps.mirror.write.mockRejectedValue(new Error("read-only fs"))
		const meta = await makeCreateDocument(deps)({
			slug: "docs/alpha",
			title: "Alpha",
			section: "docs",
			body: "body",
		})
		expect(meta.slug).toBe("docs/alpha")
	})

	test("rejects a slug that would escape the content root", async () => {
		await expect(
			makeCreateDocument(deps)({
				slug: "../etc/passwd",
				title: "x",
				section: "docs",
				body: "x",
			}),
		).rejects.toThrow(/invalid slug/)
		expect(deps.documents.insert).not.toHaveBeenCalled()
	})

	test("defaults section to docs and type to documentation", async () => {
		const meta = await makeCreateDocument(deps)({
			slug: "notes/x",
			title: "X",
			section: "",
			body: "b",
		})
		expect(meta.section).toBe("docs")
		expect(meta.type).toBe("documentation")
		expect(meta.status).toBe("published")
	})
})

describe("makeUpdateDocument", () => {
	let deps: Deps
	beforeEach(() => {
		deps = fakeDeps()
		deps.documents.getBySlug.mockResolvedValue(
			doc({ extraFields: { event: "DEF CON", points: 100 } }),
		)
	})

	test("an omitted field is unchanged, not nulled", async () => {
		// The merge is explicit because a blind `set(input)` would erase every
		// field a partial form submission did not send.
		const updated = await makeUpdateDocument(deps)("docs/alpha", {
			title: "Alpha v2",
		})
		expect(updated.title).toBe("Alpha v2")
		expect(updated.section).toBe("docs")
		expect(updated.status).toBe("published")
		expect(updated.tags).toEqual([])
	})

	test("extraFields merge rather than replace", async () => {
		const updated = await makeUpdateDocument(deps)("docs/alpha", {
			extraFields: { difficulty: "Hard" },
		})
		expect(updated.extraFields).toEqual({
			event: "DEF CON",
			points: 100,
			difficulty: "Hard",
		})
	})

	test("a missing document throws rather than creating one", async () => {
		deps.documents.getBySlug.mockResolvedValue(null)
		await expect(
			makeUpdateDocument(deps)("docs/nope", { title: "x" }),
		).rejects.toThrow(/not found/)
		expect(deps.documents.update).not.toHaveBeenCalled()
	})

	test("reindexes and mirrors after writing", async () => {
		await makeUpdateDocument(deps)("docs/alpha", { body: "new body" })
		expect(deps.documents.update).toHaveBeenCalledWith(
			"docs/alpha",
			expect.objectContaining({ updatedAt: "2026-02-03T04:05:06.000Z" }),
			"new body",
		)
		expect(deps.index.chunkAndEmbed).toHaveBeenCalledWith(
			"docs/alpha",
			"new body",
		)
		expect(deps.mirror.write).toHaveBeenCalled()
	})
})

describe("makeDeleteDocument", () => {
	test("removes the row and the backup, and reports deleted", async () => {
		const deps = fakeDeps()
		deps.documents.getBySlug.mockResolvedValue(doc())
		const res = await makeDeleteDocument(deps)("docs/alpha")
		expect(res).toEqual({ deleted: true })
		expect(deps.documents.remove).toHaveBeenCalledWith("docs/alpha")
		expect(deps.mirror.remove).toHaveBeenCalledWith("docs/alpha.md")
	})

	test("a missing document reports deleted:false and touches nothing", async () => {
		const deps = fakeDeps()
		deps.documents.getBySlug.mockResolvedValue(null)
		expect(await makeDeleteDocument(deps)("docs/nope")).toEqual({
			deleted: false,
		})
		expect(deps.documents.remove).not.toHaveBeenCalled()
	})

	test("a backup that cannot be removed does not fail the delete", async () => {
		const deps = fakeDeps()
		deps.documents.getBySlug.mockResolvedValue(doc())
		deps.mirror.remove.mockRejectedValue(new Error("EACCES"))
		expect(await makeDeleteDocument(deps)("docs/alpha")).toEqual({
			deleted: true,
		})
	})
})

describe("makeGetDocument", () => {
	test("returns the stored body when there is one", async () => {
		const deps = fakeDeps()
		deps.documents.getBySlug.mockResolvedValue(
			doc({ body: "stored" } as Partial<DocumentMeta> & { body: string }),
		)
		const d = await makeGetDocument(deps)("docs/alpha")
		expect(d?.body).toBe("stored")
		expect(deps.mirror.read).not.toHaveBeenCalled()
	})

	test("falls back to the on-disk backup when the body is empty", async () => {
		// The window between a migration that created rows and the first index
		// run that filled their bodies.
		const deps = fakeDeps()
		deps.documents.getBySlug.mockResolvedValue(
			doc({ body: "" } as Partial<DocumentMeta> & { body: string }),
		)
		deps.mirror.read.mockResolvedValue("from disk")
		const d = await makeGetDocument(deps)("docs/alpha")
		expect(d?.body).toBe("from disk")
	})

	test("an unreadable backup degrades to an empty body, not a throw", async () => {
		const deps = fakeDeps()
		deps.documents.getBySlug.mockResolvedValue(
			doc({ body: "" } as Partial<DocumentMeta> & { body: string }),
		)
		deps.mirror.read.mockRejectedValue(new Error("ENOENT"))
		const d = await makeGetDocument(deps)("docs/alpha")
		expect(d?.body).toBe("")
	})

	test("null for a slug that does not exist", async () => {
		const deps = fakeDeps()
		deps.documents.getBySlug.mockResolvedValue(null)
		expect(await makeGetDocument(deps)("docs/nope")).toBeNull()
	})
})
