import { db } from "@mcpedia/db"
import { type DocumentRow, documentChunks, documents } from "@mcpedia/db/schema"
import { createEmbeddingProvider } from "@mcpedia/embeddings"
import type { DocStatus, DocumentMeta, SearchHit } from "@mcpedia/types"
import { and, eq, sql } from "drizzle-orm"

const embedder = createEmbeddingProvider()

/** Cosine similarity between two equal-length vectors. */
export function cosine(a: number[], b: number[]): number {
	if (a.length === 0 || a.length !== b.length) return 0
	let dot = 0
	let na = 0
	let nb = 0
	for (let i = 0; i < a.length; i++) {
		// The equal-length guard above makes these in-bounds, but TypeScript
		// cannot see that across two independent arrays. Binding once keeps the
		// arithmetic total: an `undefined` slipping into `dot` would make the
		// whole score NaN, and NaN silently drops the row out of every ranking
		// instead of failing loudly.
		const av = a[i] ?? 0
		const bv = b[i] ?? 0
		dot += av * bv
		na += av * av
		nb += bv * bv
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb)
	return denom === 0 ? 0 : dot / denom
}

/** Map a Drizzle row into DocumentMeta. */
function toMeta(row: DocumentRow): DocumentMeta {
	const extra = (row.extraFields ?? {}) as Record<string, unknown>
	return {
		id: row.id,
		slug: row.slug,
		title: row.title,
		type: row.type || "documentation",
		section: row.section || "docs",
		status: (row.status === "draft" ? "draft" : "published") as DocStatus,
		author: row.author || "",
		tags: row.tags || [],
		path: row.path || `${row.slug}.md`,
		createdAt: row.createdAt
			? row.createdAt.toISOString()
			: new Date().toISOString(),
		updatedAt: row.updatedAt
			? row.updatedAt.toISOString()
			: new Date().toISOString(),
		extraFields: extra,
		// Spread dynamic extra fields (CTF: event, challenge, category, difficulty, points, etc.)
		...extra,
	}
}

/** Build a prefix tsquery from free text (AND of terms, each as prefix). */
export function toTsQuery(q: string): string {
	const terms = q
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map((t) => t.replace(/[^a-zA-Z0-9_]/g, ""))
		.filter(Boolean)
	if (terms.length === 0) return ""
	return terms.map((t) => `${t}:*`).join(" & ")
}

export interface ChunkHit {
	slug: string
	chunkIndex: number
	content: string
	score: number
}

/**
 * Semantic search: embed the query, then rank document chunks by cosine
 * similarity. Cosine is computed in the app layer (pgvector isn't available on
 * the shared imrnes Postgres); for a KB-sized corpus this is instant.
 */
export async function semanticSearch(
	q: string,
	limit = 10,
): Promise<ChunkHit[]> {
	const query = q.trim()
	if (!query) return []
	const [vec] = await embedder.embed([query])
	if (!vec || vec.length === 0) return []

	const rows = await db
		.select({
			slug: documentChunks.slug,
			chunkIndex: documentChunks.chunkIndex,
			content: documentChunks.content,
			embedding: documentChunks.embedding,
		})
		.from(documentChunks)
		.where(sql`${documentChunks.embedding} IS NOT NULL`)

	return rows
		.map((r) => ({
			slug: r.slug,
			chunkIndex: r.chunkIndex,
			content: r.content,
			score: cosine(vec, (r.embedding ?? []) as number[]),
		}))
		.filter((h) => h.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
}

/**
 * Hybrid search: run FTS (ts_rank) and semantic (cosine) in parallel, then fuse
 * with Reciprocal Rank Fusion (RRF, k=60). Returns merged document-level hits.
 */
export async function hybridSearch(
	q: string,
	limit = 10,
): Promise<SearchHit[]> {
	const [fts, sem] = await Promise.all([
		keywordSearch(q, limit * 2),
		semanticSearch(q, limit * 2),
	])
	const k = 60
	const fused = new Map<
		string,
		{ score: number; snippet: string; chunk: string }
	>()

	fts.forEach((hit, i) => {
		const rrf = 1 / (k + i + 1)
		fused.set(hit.doc.slug, {
			score: (fused.get(hit.doc.slug)?.score ?? 0) + rrf,
			snippet: hit.snippet,
			chunk: "",
		})
	})
	sem.forEach((hit, i) => {
		const rrf = 1 / (k + i + 1)
		const prev = fused.get(hit.slug)
		fused.set(hit.slug, {
			score: (prev?.score ?? 0) + rrf,
			snippet: prev?.snippet ?? hit.content.slice(0, 160),
			chunk: prev?.chunk || hit.content,
		})
	})

	const slugs = [...fused.entries()]
		.sort((a, b) => b[1].score - a[1].score)
		.slice(0, limit)
		.map(([slug]) => slug)

	if (slugs.length === 0) return []
	const rows = await db
		.select()
		.from(documents)
		.where(
			and(
				eq(documents.status, "published"),
				sql`${documents.slug} IN ${slugs}`,
			),
		)

	const bySlug = new Map(rows.map((r) => [r.slug, r]))
	return slugs
		.map((slug, _i) => {
			const row = bySlug.get(slug)
			if (!row) return null
			const m = fused.get(slug)!
			return {
				doc: toMeta(row),
				rank: m.score,
				snippet: m.snippet,
			} as SearchHit
		})
		.filter((x): x is SearchHit => x !== null)
}

/**
 * Postgres FTS keyword search over published documents.
 * Ranks by ts_rank and returns a headline snippet for display.
 */
export async function keywordSearch(
	q: string,
	limit = 20,
): Promise<SearchHit[]> {
	const query = toTsQuery(q)
	if (!query) return []

	const rows = await db
		.select({
			doc: documents,
			rank: sql<number>`ts_rank(${documents.searchVector}, to_tsquery('simple', ${query}))`,
			snippet: sql<string>`ts_headline('simple', ${documents.body}, to_tsquery('simple', ${query}), 'MaxWords=25, MinWords=5, StartSel=<mark>, StopSel=</mark>')`,
		})
		.from(documents)
		.where(
			and(
				eq(documents.status, "published"),
				sql`${documents.searchVector} @@ to_tsquery('simple', ${query})`,
			),
		)
		.orderBy(
			sql`ts_rank(${documents.searchVector}, to_tsquery('simple', ${query})) desc`,
		)
		.limit(limit)

	return rows.map((r) => ({
		doc: toMeta(r.doc),
		rank: r.rank,
		snippet: r.snippet,
	}))
}

export { toMeta }
