/**
 * Adapters for the two non-database ports: chunking/embedding and the
 * on-disk markdown mirror.
 *
 * These are thin on purpose. Their value is that they exist as named,
 * swappable pieces: a use case takes `index` and `mirror`, so a test can
 * substitute a `vi.fn()` and assert the CALL (was the index attempted? did the
 * backup fail harmlessly?) rather than the effect.
 */
import {
	chunkText,
	createEmbeddingProvider,
	embedChunks,
} from "@mcpedia/embeddings"
import { CONTENT_ROOT } from "@mcpedia/config"
import { stringifyFile, parseFile } from "@mcpedia/parser"
import { existsSync, unlinkSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { db } from "@mcpedia/db"
import { documentChunks, documents } from "@mcpedia/db/schema"
import { eq } from "drizzle-orm"
import type { ContentMirror, ContentParser, IndexingPort } from "../domain"

// The provider is created ONCE per process, not per call. Constructing it per
// call would re-read model configuration and re-open a handle on every indexed
// chunk, which for a full-corpus run is thousands of times more expensive than
// the embedding itself.
const embedder = createEmbeddingProvider()

/**
 * Chunk a body, embed the chunks, and replace `document_chunks` for the slug.
 *
 * The delete-and-insert runs in ONE transaction. This is load-bearing, not
 * tidiness: two separate statements mean a delete that commits followed by an
 * insert that fails leaves the document with zero chunks — and because every
 * caller logs-and-continues on indexing errors, that failure is invisible. The
 * document simply stops appearing in semantic and hybrid search.
 *
 * `concurrency: 16` is bounded rather than unbounded so a full-corpus run cannot
 * exhaust memory against a local model.
 */
export const embeddingIndex: IndexingPort = {
	async chunkAndEmbed(slug: string, body: string): Promise<number> {
		const [doc] = await db
			.select({ id: documents.id })
			.from(documents)
			.where(eq(documents.slug, slug))
		if (!doc) return 0

		const chunks = chunkText(body, { size: 1000, overlap: 150 })
		if (chunks.length === 0) return 0

		const vectors = await embedChunks(embedder, chunks, 16)
		if (vectors.length !== chunks.length) {
			throw new Error(
				`chunk/embedding count mismatch for ${slug}: ${chunks.length} vs ${vectors.length}`,
			)
		}

		await db.transaction(async (tx) => {
			await tx.delete(documentChunks).where(eq(documentChunks.slug, slug))
			await tx.insert(documentChunks).values(
				chunks.map((content: string, i: number) => ({
					documentId: doc.id,
					slug,
					chunkIndex: i,
					content,
					embedding: vectors[i],
				})),
			)
		})
		return chunks.length
	},

	async rebuild(slug: string): Promise<number> {
		const [doc] = await db
			.select({ body: documents.body })
			.from(documents)
			.where(eq(documents.slug, slug))
		if (!doc) return 0
		return embeddingIndex.chunkAndEmbed(slug, doc.body)
	},
}

/**
 * The on-disk markdown mirror.
 *
 * The database is the source of truth and these files are backups, so nothing
 * here is allowed to be load-bearing. Every caller wraps these calls; this
 * module does not swallow errors itself, because a caller that wants to log the
 * failure needs to see it.
 */
export const contentMirror: ContentMirror = {
	async write({ relPath, meta, body }) {
		stringifyFile(join(CONTENT_ROOT, relPath), relPath, meta, body)
	},
	async remove(relPath: string): Promise<boolean> {
		const abs = join(CONTENT_ROOT, relPath)
		if (!existsSync(abs)) return false
		unlinkSync(abs)
		return true
	},
	async read(relPath: string): Promise<string> {
		return readFileSync(join(CONTENT_ROOT, relPath), "utf8")
	},
}

/**
 * The parser port.
 *
 * `parseFile` takes (absPath, relPath) and reads the file itself — verified in
 * packages/parser/src/index.ts line 40; there is no raw-text overload. So this
 * adapter ignores the `raw` the use case already holds and lets the parser read
 * the file, which is exactly what the indexer did before this refactor.
 *
 * The alternative (a `parseRaw(raw, relPath)` overload on @mcpedia/parser) would
 * remove the second disk read, but @mcpedia/parser is outside this task's scope
 * and the double read is cheap next to the embedding that follows it. The port
 * still earns its place: a use-case test supplies a stub parser and never
 * touches the disk.
 */
export const contentParser: ContentParser = {
	parse({ relPath }) {
		return parseFile(join(CONTENT_ROOT, relPath), relPath)
	},
}
