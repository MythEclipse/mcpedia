/**
 * The audit trail: what gets recorded, and what happens when recording fails.
 *
 * These assert the two properties that are decisions rather than mechanics, and
 * that nothing else in the suite covers:
 *
 *   1. Every write records exactly one entry, naming the actor.
 *   2. A FAILED audit write never fails the write it was describing.
 *
 * (2) is the one worth having a test for. It is the property most likely to be
 * "fixed" by someone who sees an audit gap and assumes the audit should be
 * authoritative — and reversing it silently discards user work.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
	makeCreateDocument,
	makeDeleteDocument,
	makeUpdateDocument,
} from "./document.use-cases.ts"
import { makeIndexContentFile } from "./index.use-cases.ts"
import { makeRestoreRevision } from "./revision.use-cases.ts"
import { metadataFor, SYSTEM_ACTOR } from "./audit.ts"
import type { ActivityRepository, AuditEntry, DocumentMeta } from "../domain"

/** Records everything written, so a test can assert on the trail itself. */
function fakeActivity() {
	const entries: AuditEntry[] = []
	const repo: ActivityRepository = {
		record: async (entry) => {
			entries.push(entry)
		},
		list: async () => [],
	}
	return { repo, entries }
}

function fakeDocument(over: Partial<DocumentMeta> = {}): DocumentMeta {
	return {
		id: "d",
		slug: "d",
		title: "T",
		type: "documentation",
		section: "docs",
		status: "published",
		author: "a",
		tags: [],
		path: "docs/d.md",
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		extraFields: {},
		...over,
	}
}

function fakeDocuments(doc: DocumentMeta | null = fakeDocument()) {
	const updates: Array<{ slug: string; meta: DocumentMeta; body: string }> = []
	return {
		list: async () => [],
		getBySlug: async () => doc,
		getRelated: async () => [],
		listSections: async () => [],
		insert: async () => {},
		update: async (slug, meta, body) => {
			updates.push({ slug, meta, body })
		},
		remove: async () => ({ deleted: true }),
		upsertFromFile: async () => {},
		listForExport: async () => [],
		readContentFile: async () => "",
		listContentFiles: async () => [],
		updates,
	}
}

const NOW = () => new Date("2026-01-02T00:00:00.000Z")

/**
 * @param stored the document `getBySlug` reports. `null` for a create (nothing
 * exists yet), the default document for update/delete/restore.
 */
function deps(
	extra: Record<string, unknown> = {},
	stored: DocumentMeta | null = fakeDocument(),
) {
	const { repo, entries } = fakeActivity()
	const base = {
		documents: fakeDocuments(stored),
		revisions: {
			list: async () => [],
			getById: async () => null,
			getLatestBody: async () => null,
			insert: async () => {},
			getDocumentRef: async () => null,
		},
		index: { chunkAndEmbed: async () => 1, rebuild: async () => 1 },
		mirror: {
			write: async () => {},
			remove: async () => true,
			read: async () => "",
		},
		activity: repo,
		now: NOW,
		...extra,
	}
	return { ...base, entries }
}

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("every write records one entry", () => {
	it("create records the slug, the section and the actor", async () => {
		// ONE deps() call, destructured once. Calling `deps()` separately to get at
		// `entries` builds a SECOND repository with its own array, so the assertion
		// inspects a trail nothing ever wrote to.
		const d = deps(
			{ actor: { via: "session", role: "admin", userId: "u-7" } },
			null,
		)
		const create = makeCreateDocument(d)
		await create({ slug: "d", title: "T", section: "docs", body: "# x" })

		expect(d.entries).toHaveLength(1)
		expect(d.entries[0]).toMatchObject({
			action: "create",
			resource: "document",
			resourceId: "d",
			actor: { via: "session", role: "admin", userId: "u-7" },
		})
	})

	it("update records only the fields that actually changed", async () => {
		// Only `title` differs from the stored document.
		const d = deps()
		const update = makeUpdateDocument(d)
		await update("d", { title: "New" })

		expect(d.entries[0]?.action).toBe("update")
		const changes = d.entries[0]?.metadata.changes as Array<{
			field: string
			from: string
			to: string
		}>
		expect(changes.map((c) => c.field)).toEqual(["title"])
		expect(changes[0]).toMatchObject({ from: "T", to: "New" })
	})

	it("delete records the title, because the row is gone by the time anyone reads it", async () => {
		const d = deps()
		const remove = makeDeleteDocument(d)
		await remove("d")

		expect(d.entries[0]).toMatchObject({
			action: "delete",
			resourceId: "d",
			metadata: { title: "T", section: "docs" },
		})
	})

	it("index records which file and which reason", async () => {
		const d = deps()
		const indexFile = makeIndexContentFile({
			...d,
			parser: {
				parse: () => ({
					meta: fakeDocument({ slug: "d" }),
					body: "# x",
				}),
			},
		})
		await indexFile("docs/d.md", "git-push")

		expect(d.entries[0]).toMatchObject({
			action: "index",
			metadata: { reason: "git-push", relPath: "docs/d.md" },
		})
	})

	it("restore records which revision was rolled back to", async () => {
		const d = deps({
			revisions: {
				list: async () => [],
				getById: async () => ({
					id: "r1",
					slug: "d",
					revisionNo: 7,
					title: "T",
					body: "# old",
					meta: {},
					createdAt: "2026-01-01T00:00:00.000Z",
				}),
				getLatestBody: async () => null,
				insert: async () => {},
				getDocumentRef: async () => ({ documentId: "doc-1", slug: "d" }),
			},
		})
		const restore = makeRestoreRevision(d as never)
		await restore("r1")

		expect(d.entries[0]).toMatchObject({
			action: "restore",
			metadata: { revisionId: "r1", revisionNo: 7 },
		})
	})
})

describe("an absent principal is recorded, not skipped", () => {
	it("a write with no actor is a SYSTEM write, not an unrecorded one", async () => {
		const d = deps({}, null)
		const create = makeCreateDocument(d)
		await create({ slug: "d", title: "T", section: "docs", body: "# x" })

		// The whole point: automation is the majority of writes here, and a trail
		// with gaps exactly where the indexer writes is worse than one that admits
		// it does not know who acted.
		expect(d.entries).toHaveLength(1)
		expect(d.entries[0]?.actor).toEqual(SYSTEM_ACTOR)
		expect(d.entries[0]?.actor.userId).toBeUndefined()
	})

	it("no activity repository means no recording, and still no failure", async () => {
		const create = makeCreateDocument(
			deps({ activity: null as unknown as ActivityRepository }, null),
		)
		await expect(
			create({ slug: "d", title: "T", section: "docs", body: "# x" }),
		).resolves.toMatchObject({ slug: "d" })
	})
})

describe("a failed audit write never fails the write", () => {
	it("create still resolves when recording rejects", async () => {
		const failing: ActivityRepository = {
			record: async () => {
				throw new Error("audit table locked")
			},
			list: async () => [],
		}
		const create = makeCreateDocument(deps({ activity: failing }, null))

		// Losing a user's document to protect a record of it is the worse failure
		// by a wide margin, and the log line above is what makes the gap visible.
		await expect(
			create({ slug: "d", title: "T", section: "docs", body: "# x" }),
		).resolves.toMatchObject({ slug: "d" })
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining("audit"))
	})

	it("delete still resolves when recording rejects", async () => {
		const failing: ActivityRepository = {
			record: async () => {
				throw new Error("audit table locked")
			},
			list: async () => [],
		}
		const remove = makeDeleteDocument(deps({ activity: failing }))
		await expect(remove("d")).resolves.toEqual({ deleted: true })
	})
})

describe("metadataFor", () => {
	it("omits a field whose value did not change", () => {
		expect(metadataFor("update", { title: ["a", "a"] })).not.toHaveProperty(
			"changes",
		)
	})

	it("labels the change list with the action", () => {
		const meta = metadataFor("update", { title: ["a", "b"] })
		expect(meta.action).toBe("update")
	})

	it("carries extra fields through", () => {
		expect(metadataFor("index", {}, { reason: "cli" })).toMatchObject({
			reason: "cli",
		})
	})
})
