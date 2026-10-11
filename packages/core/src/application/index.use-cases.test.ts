/**
 * Unit tests for the indexing use cases, with faked collaborators.
 *
 * The behaviour worth pinning is the failure policy: a missing embedding
 * provider must degrade to "keyword-searchable only", never abort a run. That
 * decision was made before this refactor and is easy to lose in a rewrite,
 * because catching an error and continuing looks like a mistake unless the test
 * says what it is for.
 */
import { describe, expect, test, vi } from "vitest"
import { makeIndexContentFile, makeRunFullIndex } from "./index.use-cases"
import type { DocumentMeta } from "../domain"

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
		updatedAt: "2026-01-05T00:00:00.000Z",
		extraFields: {},
		...over,
	}
}

function fakeDeps(files: string[] = ["docs/alpha.md"]) {
	return {
		documents: {
			listContentFiles: vi.fn(async () => files),
			readContentFile: vi.fn(async () => "---\ntitle: Alpha\n---\n\nbody"),
			upsertFromFile: vi.fn(async () => {}),
		},
		revisions: {
			getLatestBody: vi.fn(
				async () => null as null | { body: string; revisionNo: number },
			),
			insert: vi.fn(async () => {}),
		},
		index: {
			chunkAndEmbed: vi.fn(async () => 4),
			rebuild: vi.fn(async () => 4),
		},
		parser: { parse: vi.fn(() => ({ meta: doc(), body: "body" })) },
		log: vi.fn(),
		now: () => new Date("2026-02-03T04:05:06.000Z"),
	}
}

describe("makeIndexContentFile", () => {
	test("upserts, embeds and snapshots for one file", async () => {
		const deps = fakeDeps()
		const res = await makeIndexContentFile(deps)("docs/alpha.md", "git-push")

		expect(res).toEqual({ indexed: true, chunks: 4, revision: true })
		expect(deps.documents.upsertFromFile).toHaveBeenCalledOnce()
		expect(deps.index.chunkAndEmbed).toHaveBeenCalledWith("docs/alpha", "body")
		expect(deps.revisions.insert).toHaveBeenCalledOnce()
	})

	test("preserves an author-declared updatedAt", async () => {
		// Otherwise every reindex rewrites history.
		const deps = fakeDeps()
		await makeIndexContentFile(deps)("docs/alpha.md")
		expect(deps.documents.upsertFromFile).toHaveBeenCalledWith(
			expect.objectContaining({ updatedAt: "2026-01-05T00:00:00.000Z" }),
		)
	})

	test("an embedding failure does NOT abort the file — FTS still works", async () => {
		const deps = fakeDeps()
		deps.index.chunkAndEmbed.mockRejectedValue(new Error("provider down"))
		const res = await makeIndexContentFile(deps)("docs/alpha.md")
		expect(res.indexed).toBe(true)
		expect(res.chunks).toBe(0)
		// The row is still written and the revision still taken.
		expect(deps.documents.upsertFromFile).toHaveBeenCalledOnce()
		expect(deps.revisions.insert).toHaveBeenCalledOnce()
	})

	test("the failure is logged, not swallowed", async () => {
		// "Every caller logs-and-continues" is precisely what once made a
		// chunk/embedding failure invisible until documents stopped appearing in
		// semantic search. Silence is the bug.
		const deps = fakeDeps()
		deps.index.chunkAndEmbed.mockRejectedValue(new Error("provider down"))
		await makeIndexContentFile(deps)("docs/alpha.md")
		const logged = deps.log.mock.calls.map((c) => String(c[0])).join("\n")
		expect(logged).toContain("embed FAILED")
		expect(logged).toContain("docs/alpha")
	})

	test("a file whose body is unchanged snapshots no revision", async () => {
		const deps = fakeDeps()
		deps.revisions.getLatestBody.mockResolvedValue({
			body: "body",
			revisionNo: 4,
		})
		const res = await makeIndexContentFile(deps)("docs/alpha.md")
		expect(res.revision).toBe(false)
		expect(deps.revisions.insert).not.toHaveBeenCalled()
	})

	test("the reason defaults to 'index'", async () => {
		const deps = fakeDeps()
		await makeIndexContentFile(deps)("docs/alpha.md")
		expect(deps.revisions.insert).toHaveBeenCalledWith(
			expect.objectContaining({ reason: "index" }),
		)
	})
})

describe("makeRunFullIndex", () => {
	test("aggregates counts across every file", async () => {
		const deps = fakeDeps(["a.md", "b.md", "c.md"])
		deps.documents.readContentFile.mockImplementation(async (p: string) => p)
		deps.parser.parse.mockImplementation(({ relPath }) => ({
			meta: doc({ slug: relPath, path: relPath }),
			body: "body",
		}))

		const res = await makeRunFullIndex(deps)("reindex")
		expect(res.indexed).toBe(3)
		expect(res.chunks).toBe(12)
		expect(res.revisions).toBe(3)
	})

	test("one bad file does not stop the rest of the corpus", async () => {
		const deps = fakeDeps(["good.md", "bad.md", "good2.md"])
		deps.documents.readContentFile.mockImplementation(async (p: string) => {
			if (p === "bad.md") throw new Error("EACCES")
			return p
		})
		deps.parser.parse.mockImplementation(({ relPath }) => ({
			meta: doc({ slug: relPath, path: relPath }),
			body: "body",
		}))

		// The embed failure is swallowed; an unreadable FILE is not, because
		// there is nothing to index and nothing to degrade to.
		await expect(makeRunFullIndex(deps)()).rejects.toThrow("EACCES")
	})

	test("walks files sequentially, not concurrently", async () => {
		// Concurrency would exhaust memory against a local embedding model and
		// would race the per-document revision numbering.
		const deps = fakeDeps(["a.md", "b.md"])
		let active = 0
		let maxActive = 0
		deps.parser.parse.mockImplementation(() => {
			active++
			maxActive = Math.max(maxActive, active)
			active--
			return { meta: doc(), body: "body" }
		})
		await makeRunFullIndex(deps)()
		expect(maxActive).toBe(1)
	})

	test("an empty corpus indexes nothing and does not throw", async () => {
		const deps = fakeDeps([])
		expect(await makeRunFullIndex(deps)()).toEqual({
			indexed: 0,
			chunks: 0,
			revisions: 0,
		})
	})
})
