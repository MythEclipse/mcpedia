/**
 * Unit tests for the indexing job processor.
 *
 * The behaviour worth pinning is WHERE the worker reads documents from, because
 * getting it wrong is invisible: the worker ran `indexContentFile`/`runFullIndex`
 * (which read CONTENT_ROOT on disk) from `/opt/mcpedia-worker/current/dist`, where
 * the gitignored mirror does not exist. Every job failed with ENOENT and BullMQ
 * recorded it as a failed job — 87 of them — while `queue_status` reported the
 * corpus as merely "not indexed yet". Nothing looked broken.
 *
 * So these tests assert the store-backed path, and they are written to FAIL if
 * the disk path comes back.
 */
import { describe, expect, test, vi } from "vitest"
import { makeIndexJobProcessor, type ReindexCounts } from "./worker"

function counts(over: Partial<ReindexCounts> = {}): ReindexCounts {
	return { retained: 1, missing: 0, failed: 0, ...over }
}

function fakeDeps(
	impl: (opts: { slugs?: string[]; status?: string }) => ReindexCounts = () =>
		counts(),
) {
	return {
		reindexFromStore: vi.fn(
			async (opts: { slugs?: string[]; status?: string }) => impl(opts),
		),
		consolidate: vi.fn(async () => ({ operationId: "op-1" })),
		log: vi.fn(),
	}
}

function job(name: string, data: unknown) {
	return { name, data, log: vi.fn(async () => 1) }
}

describe("makeIndexJobProcessor — index-doc", () => {
	test("re-retains the STORED body, keyed by slug with the extension stripped", async () => {
		// The load-bearing detail: `listForExport({slugs})` matches
		// `documents.slug`, which has no extension. Passing the job's relPath
		// straight through ("docs/x.md") would match zero rows, so the reindex
		// would report MISS and index nothing — quietly reinventing the bug this
		// fix removes.
		const deps = fakeDeps()
		const process = makeIndexJobProcessor(deps)

		await process(job("index-doc", { relPath: "docs/x.md", reason: "mcp" }))

		expect(deps.reindexFromStore).toHaveBeenCalledWith({ slugs: ["docs/x"] })
	})

	test("handles .mdx the same way as .md", async () => {
		const deps = fakeDeps()
		await makeIndexJobProcessor(deps)(
			job("index-doc", { relPath: "notes/a.mdx", reason: "mcp" }),
		)
		expect(deps.reindexFromStore).toHaveBeenCalledWith({ slugs: ["notes/a"] })
	})

	test("a document that failed to retain is a FAILED job, so BullMQ retries", async () => {
		// retained=0 with failures means hindsight is unreachable or the bank is
		// wrong. Reporting success here would make "nothing is searchable" and
		// "everything is fine" the same signal, which is precisely how the
		// ENOENT bug stayed invisible.
		const deps = fakeDeps(() => counts({ retained: 0, failed: 1 }))
		await expect(
			makeIndexJobProcessor(deps)(
				job("index-doc", { relPath: "docs/x.md", reason: "mcp" }),
			),
		).rejects.toThrow(/retained nothing/)
	})

	test("a partial failure still succeeds — re-running the corpus costs more than it buys", async () => {
		const deps = fakeDeps(() => counts({ retained: 4, failed: 1 }))
		const res = await makeIndexJobProcessor(deps)(
			job("index-doc", { relPath: "docs/x.md", reason: "mcp" }),
		)
		expect(res).toEqual({ retained: 4, missing: 0, failed: 1 })
	})

	test("a slug with no row is not a failure", async () => {
		// Nothing to retain and nothing broken: the document was deleted between
		// enqueue and processing, which is a normal race, not an error.
		const deps = fakeDeps(() => counts({ retained: 0, missing: 1 }))
		const res = await makeIndexJobProcessor(deps)(
			job("index-doc", { relPath: "docs/gone.md", reason: "mcp" }),
		)
		expect(res).toEqual({ retained: 0, missing: 1, failed: 0 })
	})

	test("a slug matching NO row at all is logged, so it is not read as success", async () => {
		// All three counts at zero is distinguishable from a retain only by
		// knowing the loop never ran. Without the warning, a reindex for a
		// deleted-or-renamed slug is byte-identical in the log to one that
		// re-retained the document — the same "reports success while indexing
		// nothing" silence this worker was fixed for.
		const deps = fakeDeps(() => counts({ retained: 0 }))
		const j = job("index-doc", { relPath: "docs/renamed.md", reason: "mcp" })

		await makeIndexJobProcessor(deps)(j)

		const logged = vi
			.mocked(deps.log as (m: string) => void)
			.mock.calls.map((c) => String(c[0]))
			.join("\n")
		expect(logged).toContain("WARNING")
		expect(logged).toContain("docs/renamed")
	})
})

describe("makeIndexJobProcessor — index-all", () => {
	test("covers published AND draft, summing the counts", async () => {
		// A disk walk indexed every file it found regardless of frontmatter, and
		// the write path embeds a draft as readily as a published document. So a
		// full reindex that only walked `published` would DROP drafts from search
		// that writing them had put there — silently, which is the failure mode
		// this file exists to stop repeating.
		const deps = fakeDeps(({ status }) =>
			status === "draft" ? counts({ retained: 2 }) : counts({ retained: 5 }),
		)
		const res = await makeIndexJobProcessor(deps)(
			job("index-all", { reason: "reindex" }),
		)

		expect(deps.reindexFromStore).toHaveBeenCalledWith({ status: "published" })
		expect(deps.reindexFromStore).toHaveBeenCalledWith({ status: "draft" })
		expect(res).toEqual({ retained: 7, missing: 0, failed: 0 })
	})

	test("consolidates once, after the corpus landed", async () => {
		const deps = fakeDeps()
		await makeIndexJobProcessor(deps)(job("index-all", { reason: "reindex" }))
		expect(deps.consolidate).toHaveBeenCalledTimes(1)
	})

	test("a consolidation failure does NOT fail a successful reindex", async () => {
		// Search still works on facts alone; failing the job would re-run the
		// entire corpus on retry to fix something the corpus did not cause.
		const deps = fakeDeps()
		vi.mocked(deps.consolidate).mockRejectedValue(new Error("503 upstream"))

		const res = await makeIndexJobProcessor(deps)(
			job("index-all", { reason: "reindex" }),
		)
		// Two passes (published + draft), the fake reports one retain each.
		expect(res).toEqual({ retained: 2, missing: 0, failed: 0 })
	})

	test("retaining nothing at all is NOT a failure when nothing failed", async () => {
		// An empty corpus is a legitimate no-op.
		const deps = fakeDeps(() => counts({ retained: 0 }))
		const res = await makeIndexJobProcessor(deps)(
			job("index-all", { reason: "reindex" }),
		)
		expect(res).toEqual({ retained: 0, missing: 0, failed: 0 })
	})

	test("a wholesale failure IS a failed job", async () => {
		const deps = fakeDeps(() => counts({ retained: 0, failed: 36 }))
		await expect(
			makeIndexJobProcessor(deps)(job("index-all", { reason: "reindex" })),
		).rejects.toThrow(/retained nothing/)
	})
})

describe("makeIndexJobProcessor — dispatch", () => {
	test("an unknown job type is an error, not a silent success", async () => {
		// A typo'd job name that returns quietly leaves work permanently
		// unscheduled with nothing in the logs.
		const deps = fakeDeps()
		await expect(
			makeIndexJobProcessor(deps)(job("index-alll", { reason: "reindex" })),
		).rejects.toThrow(/unknown job type/)
		expect(deps.reindexFromStore).not.toHaveBeenCalled()
	})
})
