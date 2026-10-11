/**
 * Drizzle-backed implementation of the revision repository.
 *
 * Split from the document repository because revisions are read far more often
 * than they are written, and because the two answer different questions. The
 * notable query here is `getLatestBody`, which exists so `shouldCreateRevision`
 * can be asked its question without pulling a revision's full body into memory
 * on every indexed file.
 */
import { db } from "@mcpedia/db"
import { documents, documentRevisions } from "@mcpedia/db/schema"
import { eq, desc, sql } from "drizzle-orm"
import type {
	RevisionDetail,
	RevisionRepository,
	RevisionSummary,
} from "../domain"

export function createRevisionRepository(
	client: typeof db = db,
): RevisionRepository {
	return {
		async list(slug, limit, offset) {
			const [doc] = await client
				.select({ id: documents.id })
				.from(documents)
				.where(eq(documents.slug, slug))
			if (!doc) return []

			const rows = await client
				.select({
					id: documentRevisions.id,
					slug: documentRevisions.slug,
					revisionNo: documentRevisions.revisionNo,
					title: documentRevisions.title,
					reason: documentRevisions.reason,
					createdAt: documentRevisions.createdAt,
					bodyLength: sql<number>`length(${documentRevisions.body})`,
				})
				.from(documentRevisions)
				.where(eq(documentRevisions.documentId, doc.id))
				.orderBy(desc(documentRevisions.revisionNo))
				.limit(limit)
				.offset(offset)

			return rows.map((r) => ({
				id: r.id,
				slug: r.slug,
				revisionNo: r.revisionNo,
				title: r.title,
				reason: r.reason,
				createdAt: r.createdAt.toISOString(),
				bodyLength: r.bodyLength,
			}))
		},

		async getById(id) {
			const [row] = await client
				.select({
					id: documentRevisions.id,
					revisionNo: documentRevisions.revisionNo,
					title: documentRevisions.title,
					body: documentRevisions.body,
					meta: documentRevisions.meta,
				})
				.from(documentRevisions)
				.where(eq(documentRevisions.id, id))
			if (!row) return null
			return {
				id: row.id,
				revisionNo: row.revisionNo,
				title: row.title,
				body: row.body,
				meta: row.meta,
			}
		},

		async getLatestBody(slug) {
			const [doc] = await client
				.select({ id: documents.id })
				.from(documents)
				.where(eq(documents.slug, slug))
			if (!doc) return null

			const [latest] = await client
				.select({
					body: documentRevisions.body,
					revisionNo: documentRevisions.revisionNo,
				})
				.from(documentRevisions)
				.where(eq(documentRevisions.documentId, doc.id))
				.orderBy(desc(documentRevisions.revisionNo))
				.limit(1)

			if (!latest) return null
			return { body: latest.body, revisionNo: latest.revisionNo }
		},

		async insert(input) {
			const [doc] = await client
				.select({ id: documents.id })
				.from(documents)
				.where(eq(documents.slug, input.slug))
			if (!doc) return

			await client.insert(documentRevisions).values({
				documentId: doc.id,
				slug: input.slug,
				revisionNo: input.revisionNo,
				title: input.title,
				body: input.body,
				// `meta` is the domain's RevisionMeta, which is the same shape
				// the column is declared with — no cast needed, and none
				// possible to get wrong.
				meta: input.meta,
				reason: input.reason,
			})
		},

		async getDocumentRef(id) {
			const [rev] = await client
				.select({
					documentId: documentRevisions.documentId,
					slug: documentRevisions.slug,
				})
				.from(documentRevisions)
				.where(eq(documentRevisions.id, id))
			if (!rev) return null
			return { documentId: rev.documentId, slug: rev.slug }
		},
	}
}
