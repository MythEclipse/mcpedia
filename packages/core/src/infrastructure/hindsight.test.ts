/**
 * The hindsight adapter, against a stubbed fetch.
 *
 * ## WHY THESE TESTS EXIST WHEN THE INTERESTING CLAIMS ARE ABOUT hindsight
 *
 * Three properties of the hindsight service decide whether document search works
 * at all, and all three were established by probing the running instance
 * (Hindsight HTTP API 0.10.2) rather than by reading docs:
 *
 *   1. `metadata` survives fact extraction with its keys intact — which is why
 *      the slug rides in metadata.
 *   2. Observations carry NEITHER `document_id` NOR `metadata` — which is why
 *      recall filters `types: ["world"]`.
 *   3. `update_mode: "replace"` supersedes prior facts for the same
 *      `document_id` — which is why retain sends it.
 *
 * Each is a way for search to fail SILENTLY: a slug that arrives empty produces
 * no hits and no error; an observation instead of a fact produces hits that
 * cannot be linked; a missing replace leaves an edited document searchable at
 * its old content forever. A stub can only assert that this adapter asks for the
 * right thing — that the service then honours it is the service's contract, and
 * is why the findings are recorded as comments at the top of hindsight.ts too.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const dbMock = {
	select: vi.fn(),
}
vi.mock("@mcpedia/db", () => ({ db: dbMock }))

type Adapter = typeof import("./hindsight.ts")
let adapter: Adapter

/**
 * Import the adapter fresh for every test.
 *
 * `ensureBank` memoises the bank-creation promise in module state, which is what
 * production wants — one PUT per process instead of one per query. A file-scope
 * import defeats that here: the first test consumes the single PUT and every
 * later test sees an empty call log, which reads as "recall is broken" when only
 * the harness was. Importing after `vi.resetModules()` gives each test its own
 * instance and an honest call log.
 */
async function loadAdapter(): Promise<Adapter> {
	return import("./hindsight.ts")
}

/** Build a Drizzle-ish chain that resolves to `rows`. */
function selectReturning(rows: unknown[]) {
	const chain = {
		from: () => chain,
		where: () => chain,
		limit: () => Promise.resolve(rows),
		// Biome flags `then` because any object with one is thenable by `await`.
		// That is the point: Drizzle's query builder IS a thenable, and the
		// adapter awaits the chain. Making it resolve without one would test a
		// different shape than production sees.
		// biome-ignore lint/suspicious/noThenProperty: a thenable is the real contract
		then: (resolve: (v: unknown[]) => void) =>
			Promise.resolve(rows).then(resolve),
	}
	return chain
}

/** Capture every fetch the adapter makes and reply from a queue. */
function stubFetch(...replies: unknown[]) {
	const calls: { url: string; init: RequestInit }[] = []
	const queue = [...replies]
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init: RequestInit) => {
			calls.push({ url: String(url), init })
			const body = queue.shift()
			return {
				ok: true,
				status: 200,
				json: async () => body ?? {},
				text: async () => JSON.stringify(body ?? {}),
			}
		}),
	)
	return calls
}

/**
 * The JSON body of the nth call, parsed.
 *
 * Typed `unknown` on purpose: it is an arbitrary request body, and a narrower
 * return type would either lie about it or force a cast at every call site.
 */
function bodyOf(calls: { init: RequestInit }[], n: number): unknown {
	return JSON.parse(String(calls[n]?.init?.body ?? "{}"))
}

describe("hindsight adapter", () => {
	beforeEach(async () => {
		vi.resetModules()
		vi.unstubAllGlobals()
		process.env.HINDSIGHT_API_URL = "http://hs.test"
		process.env.HINDSIGHT_BANK_ID = "mcpedia-test"
		adapter = await loadAdapter()
	})

	describe("hindsightIndex", () => {
		it("carries the slug in metadata and asks for a replace", async () => {
			dbMock.select.mockReturnValue(
				selectReturning([{ title: "Ret2win", tags: ["pwn"] }]),
			)
			const calls = stubFetch({}, { success: true })

			await adapter.hindsightIndex.chunkAndEmbed(
				"ctf/heap/ret2win",
				"body text",
			)

			const retain = bodyOf(calls, 1)
			const item = (retain as { items: Record<string, unknown>[] }).items[0]
			// Finding 3: without replace, an edited document keeps its old facts
			// searchable forever.
			expect(item?.update_mode).toBe("replace")
			// Finding 1: metadata is the slug carrier.
			expect(item?.metadata).toEqual({
				slug: "ctf/heap/ret2win",
				title: "Ret2win",
			})
			// document_id is hindsight's own identity for the document, not a slug.
			expect(item?.document_id).toBe("ctf/heap/ret2win")
			// The title is repeated in content because metadata is not keyword-indexed.
			expect(String(item?.content)).toContain("# Ret2win")
			expect(String(item?.content)).toContain("body text")
		})

		it("retains asynchronously so a write is not billed for fact extraction", async () => {
			dbMock.select.mockReturnValue(selectReturning([{ title: "T", tags: [] }]))
			const calls = stubFetch({}, { success: true })

			await adapter.hindsightIndex.chunkAndEmbed("docs/a", "b")

			// A synchronous retain costs ~5,500 LLM tokens and seconds per document,
			// inside a write that already commits a row and writes a backup.
			expect((bodyOf(calls, 1) as { async: boolean }).async).toBe(true)
		})

		it("does nothing when the slug has no row", async () => {
			dbMock.select.mockReturnValue(selectReturning([]))
			const calls = stubFetch()

			expect(await adapter.hindsightIndex.chunkAndEmbed("docs/gone", "b")).toBe(
				0,
			)
			// Not even the bank ensure: there is no document to index.
			expect(calls).toHaveLength(0)
		})

		it("rebuild re-reads the stored body rather than trusting the caller", async () => {
			dbMock.select.mockReturnValue(
				selectReturning([{ title: "T", body: "RESTORED" }]),
			)
			const calls = stubFetch({}, { success: true })

			await adapter.hindsightIndex.rebuild("docs/a")

			const retain = bodyOf(calls, 1)
			const item = (retain as { items: { content: string }[] }).items[0]
			// This is the restore-revision path: the row now holds the restored
			// body, and search must be re-indexed from THAT, not from whatever the
			// caller happened to pass.
			expect(item?.content).toContain("RESTORED")
		})
	})

	describe("recall", () => {
		it("filters types to world so every hit stays linkable", async () => {
			dbMock.select.mockReturnValue(
				selectReturning([{ slug: "docs/a", status: "published" }]),
			)
			const calls = stubFetch({}, { results: [] })

			await adapter.hybridSearch("query")

			const recallBody = bodyOf(calls, 1) as { query: string; types?: string[] }
			expect(recallBody.types).toEqual(["world"])
			expect(recallBody.query).toBe("query")
		})

		it("groups several facts from one document into a single hit", async () => {
			dbMock.select.mockReturnValue(
				selectReturning([
					{ slug: "docs/a", status: "published" },
					{ slug: "docs/b", status: "published" },
				]),
			)
			stubFetch(
				{},
				{
					results: [
						{
							id: "1",
							text: "fact one",
							metadata: { slug: "docs/a" },
							scores: { final: 0.4 },
						},
						{
							id: "2",
							text: "fact two",
							metadata: { slug: "docs/a" },
							scores: { final: 0.9 },
						},
						{
							id: "3",
							text: "other",
							metadata: { slug: "docs/b" },
							scores: { final: 0.5 },
						},
					],
				},
			)

			const hits = await adapter.hybridSearch("query", 10)

			// The UI lists documents; three facts from one page must not occupy
			// three of the ten slots.
			expect(hits).toHaveLength(2)
			expect(hits[0]?.doc.slug).toBe("docs/a")
			// The BEST-scoring fact is the one shown.
			expect(hits[0]?.rank).toBe(0.9)
			expect(hits[0]?.snippet).toBe("fact two")
		})

		it("drops a fact with no slug rather than emitting an unlinkable hit", async () => {
			dbMock.select.mockReturnValue(
				selectReturning([{ slug: "docs/a", status: "published" }]),
			)
			stubFetch(
				{},
				{
					results: [
						// An observation: no metadata at all, so no slug. Rendering it
						// would produce a result the user cannot click.
						{
							id: "1",
							text: "consolidated",
							metadata: null,
							scores: { final: 0.99 },
						},
						{
							id: "2",
							text: "real",
							metadata: { slug: "docs/a" },
							scores: { final: 0.1 },
						},
					],
				},
			)

			const hits = await adapter.hybridSearch("query")

			expect(hits).toHaveLength(1)
			expect(hits[0]?.doc.slug).toBe("docs/a")
		})

		it("excludes a slug whose row is no longer published", async () => {
			// The DB layer filters on status; a draft already in hindsight must not
			// surface. `loadMetas` returned only the published one.
			dbMock.select.mockReturnValue(selectReturning([]))
			stubFetch(
				{},
				{
					results: [
						{
							id: "1",
							text: "t",
							metadata: { slug: "docs/draft" },
							scores: { final: 1 },
						},
					],
				},
			)

			expect(await adapter.hybridSearch("query")).toEqual([])
		})

		it("orders by the fused score, falling back through the components", async () => {
			dbMock.select.mockReturnValue(
				selectReturning([
					{ slug: "docs/a", status: "published" },
					{ slug: "docs/b", status: "published" },
				]),
			)
			stubFetch(
				{},
				{
					results: [
						// No `final` anywhere in this response — the fallback chain has
						// to produce a deterministic order rather than collapsing every
						// hit to 0 and letting arrival order decide.
						{
							id: "1",
							text: "a",
							metadata: { slug: "docs/a" },
							scores: { semantic: 0.2 },
						},
						{
							id: "2",
							text: "b",
							metadata: { slug: "docs/b" },
							scores: { semantic: 0.8 },
						},
					],
				},
			)

			const hits = await adapter.hybridSearch("query")
			expect(hits.map((h) => h.doc.slug)).toEqual(["docs/b", "docs/a"])
		})

		it("an empty query never reaches the network", async () => {
			const calls = stubFetch()
			expect(await adapter.hybridSearch("   ")).toEqual([])
			expect(calls).toHaveLength(0)
		})

		it("a non-2xx throws so a caller that logs-and-continues is not fooled", async () => {
			dbMock.select.mockReturnValue(selectReturning([]))
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => ({
					ok: false,
					status: 503,
					json: async () => ({}),
					text: async () => "upstream down",
				})),
			)

			// Every caller of the indexing port logs-and-continues, so a swallowed
			// error here would mean "indexed nothing, reported success".
			await expect(adapter.hybridSearch("q")).rejects.toThrow(/503/)
		})
	})

	describe("reflect", () => {
		it("posts the query and reports the token cost back to the caller", async () => {
			const calls = stubFetch(
				{},
				{
					text: "Tcache poisoning needs no leak.",
					usage: { input_tokens: 16060, output_tokens: 323 },
				},
			)

			const answer = await adapter.reflect("which technique needs no leak?")

			expect(calls[1]?.url).toContain("/reflect")
			expect((bodyOf(calls, 1) as { query: string }).query).toBe(
				"which technique needs no leak?",
			)
			expect(answer.text).toBe("Tcache poisoning needs no leak.")
			// The cost is returned rather than hidden: a caller that runs this
			// per request needs to see what one call costs.
			expect(answer.inputTokens).toBe(16060)
		})

		it("omits budget entirely when the caller does not choose one", async () => {
			const calls = stubFetch({}, { text: "x" })

			await adapter.reflect("q")

			// Sending an explicit default would pin the server's current default
			// into this code, so an upstream change to it would be invisible here.
			expect(Object.keys(bodyOf(calls, 1) as object)).toEqual(["query"])
		})
	})

	describe("consolidate", () => {
		it("queues the work and returns the operation id", async () => {
			const calls = stubFetch({}, { operation_id: "op-1", deduplicated: false })

			const result = await adapter.consolidate()

			expect(calls[1]?.url).toContain("/consolidate")
			// An empty JSON body is what the server accepts; the operation id is
			// how the caller knows the pass was actually queued.
			expect(result.operationId).toBe("op-1")
		})
	})

	it("forgetDocument deletes by document id", async () => {
		const calls = stubFetch({ success: true })

		await adapter.forgetDocument("docs/gone")

		expect(calls[0]?.init.method).toBe("DELETE")
		expect(calls[0]?.url).toContain("/documents/docs%2Fgone")
	})
})
