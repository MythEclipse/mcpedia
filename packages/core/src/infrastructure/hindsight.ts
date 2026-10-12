/**
 * hindsight as the one search and indexing backend.
 *
 * ## WHAT THIS REPLACES
 *
 * Three code paths and two packages: Postgres FTS (`ts_rank` +
 * `ts_headline`), brute-force cosine over `document_chunks`, and their Reciprocal
 * Rank Fusion in `@mcpedia/search`, plus the chunker and embedding provider in
 * `@mcpedia/embeddings`. hindsight does chunking, embeddings, a keyword arm, a
 * semantic arm and fusion internally, so all five collapse into the two calls
 * below.
 *
 * `toMeta` stays a re-export. It maps a Drizzle row onto `DocumentMeta` and has
 * nothing to do with retrieval — `drizzle.document.repository.ts` and
 * `row-map.ts` both use it, and hindsight has no rows.
 *
 * ## THE THREE PROBE FINDINGS THIS FILE IS BUILT ON
 *
 * Verified against the running service (Hindsight HTTP API 0.10.2) rather than
 * recalled from docs. Each one is a property that silently produces a broken
 * search if guessed wrong, which is why they are asserted in hindsight.test.ts
 * rather than left as comments.
 *
 *  1. **`metadata` survives fact extraction with keys intact.** It is therefore
 *     the slug carrier — not `document_id`. `document_id` survives as well, but
 *     it is hindsight's identity for the document; using it as a slug would
 *     force slug-shaped strings into an id column.
 *
 *  2. **`types: ["world"]` is required.** On hindsight's default (all types) the
 *     top hit is usually a consolidated `observation`, and observations carry
 *     NEITHER `document_id` NOR `metadata`. A document search that returned
 *     them would emit hits it cannot link. Filtering to `world` keeps the slug
 *     reachable on every row.
 *
 *  3. **`update_mode: "replace"` supersedes the previous facts** when the
 *     `document_id` is unchanged — the stale fact genuinely leaves recall.
 *     Without it, an edited document stays searchable at its old content
 *     forever, which is the "search disagrees with the page" bug in its purest
 *     form.
 *
 * ## WHY RETAIN IS ASYNC
 *
 * A synchronous retain costs ~5,500 LLM tokens and several seconds per document
 * because it runs fact extraction inline. That is unaffordable inside a write
 * that already commits a row, writes a backup and rebuilds an index — and every
 * caller of the indexing port logs-and-continues, so the failure mode is a
 * stale index rather than a lost write. Async returns an operation id in well
 * under a second, which keeps the write path at write speed and lets search
 * freshness trail the corpus by seconds instead of minutes.
 */
import { db } from "@mcpedia/db"
import { documents } from "@mcpedia/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import type { DocumentMeta, SearchHit } from "@mcpedia/types"
import { toMeta } from "../row-map.ts"
import type { IndexingPort } from "../domain/index.js"

/**
 * The loopback address the systemd unit binds. Overridable so a containerised
 * deploy can point elsewhere without a code change.
 */
const DEFAULT_BASE_URL = "http://127.0.0.1:8890"

/**
 * Retain admits an LLM call per document, so it gets a generous ceiling; recall
 * is a read and must not hold a request open behind a slow embedding.
 */
const RETAIN_TIMEOUT_MS = 120_000
const RECALL_TIMEOUT_MS = 30_000
/**
 * Reflect is an LLM call plus a corpus-wide retrieval, so it needs more headroom
 * than either. Measured at ~6s on a three-document bank, but the context it
 * assembles grows with the corpus — 16k input tokens already at that size — so
 * the ceiling is set well above what has been observed rather than at it.
 */
const REFLECT_TIMEOUT_MS = 300_000

/**
 * Read hindsight's location PER CALL rather than at module scope.
 *
 * packages/core is imported by the web SPA for types. A module-scope
 * `process.env` read would evaluate in the browser bundle, and a module-scope
 * throw over a missing variable would take the whole SPA down for a setting
 * only the server has.
 *
 * `@mcpedia/config` is deliberately NOT imported here: its module scope reads
 * `.env` off the filesystem, which a browser cannot do, so a static import
 * would drag dotenv resolution into the SPA bundle. The two names below are
 * validated at startup by `packages/config/src/startup.ts`; reading the
 * environment again here is what keeps this module browser-safe.
 */
function baseUrl(): string {
	const raw = process.env.HINDSIGHT_API_URL
	return (raw ?? DEFAULT_BASE_URL).replace(/\/+$/, "")
}

/**
 * The bank is namespaced per deployment so two environments pointed at one
 * hindsight cannot read each other's corpus.
 */
function bankId(): string {
	return process.env.HINDSIGHT_BANK_ID ?? "mcpedia"
}

/**
 * One request, with the two failure modes every caller must handle made explicit.
 *
 * A non-2xx THROWS rather than returning: every caller logs-and-continues, and
 * a caller handed an error object would index nothing while reporting success.
 * The timeout is an AbortController rather than a promise race, because a race
 * leaves the request running and leaks a socket per write.
 */
async function call<T>(
	path: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<T> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		const res = await fetch(`${baseUrl()}${path}`, {
			...init,
			signal: controller.signal,
			headers: { "content-type": "application/json", ...init.headers },
		})
		if (!res.ok) {
			const detail = await res.text().catch(() => "")
			throw new Error(
				`hindsight ${init.method ?? "GET"} ${path} -> ${res.status}: ${detail.slice(0, 200)}`,
			)
		}
		return (await res.json()) as T
	} finally {
		clearTimeout(timer)
	}
}

/** hindsight's recall result, as far as this module depends on it. */
interface RecallResult {
	id: string
	text: string
	type?: string
	document_id?: string | null
	metadata?: Record<string, unknown> | null
	scores?: Record<string, number | null> | null
}

interface RecallResponse {
	results?: RecallResult[]
}

/**
 * Ensure the bank exists, once per process.
 *
 * hindsight creates a bank implicitly on first retain, so this only matters for
 * a fresh deploy whose first event is a RECALL rather than a write. Failures are
 * swallowed on purpose: a read-only replica or a transient outage must not stop
 * the app from booting, and the real operation will report the true problem if
 * the bank is genuinely unusable.
 */
let bankEnsured: Promise<void> | null = null
function ensureBank(): Promise<void> {
	bankEnsured ??= call(
		`/v1/default/banks/${bankId()}`,
		{
			method: "PUT",
			body: JSON.stringify({ name: bankId() }),
		},
		10_000,
	).then(
		() => undefined,
		() => undefined,
	)
	return bankEnsured
}

/**
 * The content hindsight should store for a document.
 *
 * The title is repeated in the CONTENT, not left in metadata alone. hindsight's
 * keyword arm reads content, and metadata is not keyword-indexed — so a
 * document that names its subject only in the title would be invisible to a
 * keyword search for that subject. The slug stays in metadata, where it is a
 * carrier rather than searchable text.
 */
function contentFor(title: string, body: string): string {
	return `# ${title}\n\n${body}`
}

/** Load the stored body and title for a slug, or null when it is gone. */
async function loadDocument(
	slug: string,
): Promise<{ title: string; body: string } | null> {
	const [row] = await db
		.select({ title: documents.title, body: documents.body })
		.from(documents)
		.where(eq(documents.slug, slug))
		.limit(1)
	if (!row) return null
	return { title: row.title, body: row.body ?? "" }
}

/** Load authoritative metas for a set of slugs, published only. */
async function loadMetas(slugs: string[]): Promise<DocumentMeta[]> {
	if (slugs.length === 0) return []
	const rows = await db
		.select()
		.from(documents)
		.where(
			and(eq(documents.status, "published"), inArray(documents.slug, slugs)),
		)
	return rows.map(toMeta)
}

/**
 * The indexing adapter.
 *
 * `chunkAndEmbed` and `rebuild` both land on one call, and that collapse is
 * information rather than laziness: the old implementation differed (one
 * embedded the body it was handed, the other re-read the stored row first),
 * but hindsight keys on `document_id` and replaces on it, so "rebuild this
 * slug" IS "re-send this slug's current body". Keeping two code paths would
 * imply a distinction that no longer exists.
 */
export const hindsightIndex: IndexingPort = {
	async chunkAndEmbed(slug: string, body: string): Promise<number> {
		const [meta] = await db
			.select({ title: documents.title, tags: documents.tags })
			.from(documents)
			.where(eq(documents.slug, slug))
			.limit(1)
		if (!meta) return 0

		await ensureBank()
		await call(
			`/v1/default/banks/${bankId()}/memories`,
			{
				method: "POST",
				body: JSON.stringify({
					items: [
						{
							content: contentFor(meta.title, body),
							document_id: slug,
							metadata: { slug, title: meta.title },
							tags: meta.tags ?? [],
							update_mode: "replace",
						},
					],
					async: true,
				}),
			},
			RETAIN_TIMEOUT_MS,
		)

		// hindsight reports no chunk count, and counting our own chunks would
		// reinstate the chunker this adapter exists to delete. One document is one
		// indexing unit; callers use this number for logging only.
		return 1
	},

	async rebuild(slug: string): Promise<number> {
		const doc = await loadDocument(slug)
		if (!doc) return 0
		return hindsightIndex.chunkAndEmbed(slug, doc.body)
	},
}

/**
 * Build the snippet hindsight does not provide.
 *
 * hindsight returns whole facts, not passages with the query marked. The old
 * stack used `ts_headline` with `<mark>` delimiters and the web already
 * sanitises snippets down to exactly that tag, so this reproduces the shape the
 * frontend expects rather than inventing one.
 */
function excerpt(text: string, max = 200): string {
	const flat = text.replace(/\s+/g, " ").trim()
	return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

/** The slug carried in a fact's metadata, or null when it has none. */
function slugOf(result: RecallResult): string | null {
	const slug = result.metadata?.slug
	return typeof slug === "string" && slug.length > 0 ? slug : null
}

/**
 * Run one recall and return document-level hits.
 *
 * Shared by all three public modes below. hindsight returns FACTS and one
 * document yields several, so results are grouped by slug keeping the best
 * score — the UI lists documents, and three facts from one page must not
 * occupy three of the ten slots.
 *
 * `rank` is hindsight's fused score, not a rank position, so a caller sorting by
 * rank still gets the order hindsight intended.
 */
async function recall(q: string, limit: number): Promise<SearchHit[]> {
	const query = q.trim()
	if (!query) return []

	await ensureBank()
	const response = await call<RecallResponse>(
		`/v1/default/banks/${bankId()}/memories/recall`,
		{
			method: "POST",
			// `types: ["world"]` is load-bearing, not a convenience filter: without
			// it the top hits are observations, which carry no metadata and
			// therefore cannot be linked. See finding 2 at the top of this file.
			body: JSON.stringify({ query, types: ["world"] }),
		},
		RECALL_TIMEOUT_MS,
	)

	const best = new Map<string, { result: RecallResult; rank: number }>()
	for (const [i, result] of (response.results ?? []).entries()) {
		const slug = slugOf(result)
		if (!slug) continue
		const scores = result.scores ?? {}
		// Fall back through the components so a response carrying no fused score
		// still orders deterministically instead of collapsing every hit to 0 and
		// letting arrival order decide.
		const rank = scores.final ?? scores.semantic ?? scores.keyword ?? -i
		const prev = best.get(slug)
		if (!prev || rank > prev.rank) best.set(slug, { result, rank })
	}
	if (best.size === 0) return []

	const ordered = [...best.values()]
		.sort((a, b) => b.rank - a.rank)
		.slice(0, limit)

	// The slug comes from hindsight, but the document's own row is authoritative
	// for title, section and status — the metadata copy goes stale the moment a
	// rename lands. hindsight is used only to FIND the row.
	const metas = await loadMetas([...best.keys()])
	const bySlug = new Map(metas.map((m) => [m.slug, m]))

	return ordered.flatMap(({ result, rank }) => {
		const doc = bySlug.get(slugOf(result) ?? "")
		if (!doc) return []
		return [{ doc, rank, snippet: excerpt(result.text) } satisfies SearchHit]
	})
}

/** Document-level search: the mode every caller should want. */
export async function hybridSearch(
	q: string,
	limit = 10,
): Promise<SearchHit[]> {
	return recall(q, limit)
}

/**
 * Keyword-only search.
 *
 * hindsight has no keyword-only endpoint over memories; its knowledge-base
 * search is BM25 + vector and applies to knowledge pages, not documents. So this
 * delegates to the same recall rather than pretending to be lexical. The name is
 * kept because two routers and the MCP tool surface expose it, and removing it
 * would break them for no gain — the ranking is simply hindsight's, which is
 * already hybrid. This is a deliberate behaviour change: "keyword" now means
 * "ranked by a fused score that weights keywords", not "ranked by ts_rank".
 */
export async function keywordSearch(
	q: string,
	limit = 20,
): Promise<SearchHit[]> {
	return recall(q, limit)
}

/**
 * Semantic-only search.
 *
 * Same delegation and the same caveat as `keywordSearch`: hindsight fuses its
 * arms internally and exposes no way to run one alone, so this returns the fused
 * ranking rather than a narrower one.
 */
export async function semanticSearch(
	q: string,
	limit = 10,
): Promise<SearchHit[]> {
	return recall(q, limit)
}

/**
 * Remove a document's facts from hindsight.
 *
 * Called when a document is deleted. Without it the deleted body stays
 * searchable, and the search page links to a slug that 404s.
 */
export async function forgetDocument(slug: string): Promise<void> {
	await call(
		`/v1/default/banks/${bankId()}/documents/${encodeURIComponent(slug)}`,
		{
			method: "DELETE",
		},
		RECALL_TIMEOUT_MS,
	)
}

/**
 * Synthesis across the whole corpus, answered by hindsight's own reasoning.
 *
 * ## WHY THIS EXISTS AND WHY IT IS NOT THE DEFAULT SEARCH PATH
 *
 * `recall` returns individual facts. `reflect` runs an LLM over the retrieved
 * set to answer a question no single fact answers — measured against a
 * three-document probe bank, it correctly resolved "which technique needs no
 * heap leak" by weighing tcache against House of Force and citing both.
 *
 * The cost is the reason it is not wired into the search box. Probed on the
 * live service:
 *
 *   default (budget low): 16,060 input tokens,  323 output tokens
 *   budget mid:          16,027 input tokens,  346 output tokens
 *
 * Sixteen thousand INPUT tokens per call, and barely moving when the budget is
 * lowered — because reflect always retrieves observations into context, and the
 * corpus is what dominates. A user typing into a search field must not spend
 * that per keystroke, so this is exposed as an explicit tool instead. An agent
 * that decides it needs synthesis pays for it once, on purpose.
 *
 * `{ query }` alone is a valid body — verified, no other field required.
 */
export async function reflect(
	q: string,
	options: { budget?: "low" | "mid" | "high"; maxTokens?: number } = {},
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
	await ensureBank()
	const response = await call<{
		text?: string
		usage?: { input_tokens?: number; output_tokens?: number }
	}>(
		`/v1/default/banks/${bankId()}/reflect`,
		{
			method: "POST",
			body: JSON.stringify({
				query: q,
				...(options.budget ? { budget: options.budget } : {}),
				...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
			}),
		},
		// Generous: measured at ~6s on a 3-document bank, but the LLM plus its
		// retrieval grows with the corpus, and this is a deliberate call rather
		// than something a user waits on per keystroke.
		REFLECT_TIMEOUT_MS,
	)
	return {
		text: response.text ?? "",
		inputTokens: response.usage?.input_tokens ?? 0,
		outputTokens: response.usage?.output_tokens ?? 0,
	}
}

/**
 * Consolidate facts into observations — the cross-document links recall cannot
 * express on its own.
 *
 * ## WHY THIS IS A SEPARATE, EXPLICIT STEP
 *
 * Retain writes facts. Nothing else in the request path ever creates an
 * observation, so without this call the bank holds only per-document facts and
 * `reflect` has nothing to reason across. Probed on a three-document bank:
 * consolidate turned 5 facts into 4 observations and reported
 * `deduplicated: false`.
 *
 * It is deliberately NOT part of the per-document write. Retain already carries
 * a full LLM extraction (verified: it runs per document), and consolidation
 * re-reads the whole bank; putting it on the write path would make every
 * single-document edit pay for a corpus-wide pass. Instead the full-reindex
 * worker calls this once at the end, which is the only moment the corpus is
 * known to be complete and fresh.
 *
 * The server runs it asynchronously and returns an operation id, so this
 * returns as soon as the work is queued rather than waiting for the LLM.
 */
export async function consolidate(): Promise<{ operationId: string }> {
	await ensureBank()
	const response = await call<{
		operation_id?: string
		deduplicated?: boolean
	}>(
		`/v1/default/banks/${bankId()}/consolidate`,
		{ method: "POST", body: JSON.stringify({}) },
		RECALL_TIMEOUT_MS,
	)
	return { operationId: response.operation_id ?? "" }
}

/**
 * The chunks hindsight actually indexed for one document.
 *
 * Exists for the MCP `mcpedia://docs/{slug}/facts` resource, which used to
 * compute a LOCAL chunk preview and describe it as "the chunks semantic search
 * actually sees". That description was already optimistic — a locally computed
 * segmentation can drift from the indexed one — and after hindsight it became
 * false outright, because the chunks search matches on are hindsight's.
 *
 * ## WHY /documents/{id}/chunks AND NOT RECALL
 *
 * Recall cannot answer "what is stored for THIS document". Probed and rejected:
 *
 *  - `metadata` is NOT a RecallRequest field. Sending it returns 200 with an
 *    EMPTY result set — worse than ignoring it, because it looks like "this
 *    document has no facts" rather than "you asked wrong".
 *  - `tags` is a real field but was verified NOT to narrow by an arbitrary tag:
 *    both documents came back regardless.
 *
 * Recall would also run an LLM over the whole bank to answer a question about
 * one known document. The chunks endpoint is an exact lookup by document id and
 * costs nothing, which is what an agent asking about a specific slug deserves.
 */
export async function recallDocumentFacts(
	slug: string,
): Promise<{ index: number; text: string; characters: number }[]> {
	const response = await call<{
		items?: { chunk_index: number; chunk_text: string }[]
	}>(
		`/v1/default/banks/${bankId()}/documents/${encodeURIComponent(slug)}/chunks`,
		{ method: "GET" },
		RECALL_TIMEOUT_MS,
	)
	return (response.items ?? [])
		.map((c) => ({
			index: c.chunk_index,
			text: c.chunk_text,
			characters: c.chunk_text.length,
		}))
		.sort((a, b) => a.index - b.index)
}
