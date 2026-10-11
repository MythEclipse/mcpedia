import { db } from "@mcpedia/db"
import {
	documents,
	documentRevisions,
	documentChunks,
} from "@mcpedia/db/schema"
import { reindexChunks } from "./index.service"
import { eq, desc, and, sql } from "drizzle-orm"
import { toMeta } from "./row-map"
import { CONTENT_ROOT } from "@mcpedia/config"
import { join } from "node:path"
import type { DocumentMeta } from "@mcpedia/types"

export interface RevisionSummary {
	id: string
	slug: string
	revisionNo: number
	title: string
	reason: string
	createdAt: string
	bodyLength: number
}

/** List revisions for a slug, newest first. `offset` enables paging. */
export async function listRevisions(
	slug: string,
	limit = 20,
	offset = 0,
): Promise<RevisionSummary[]> {
	const [doc] = await db
		.select({ id: documents.id })
		.from(documents)
		.where(eq(documents.slug, slug))
	if (!doc) return []

	const rows = await db
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
}

/** Fetch a single revision's full body. */
export async function getRevision(
	id: string,
): Promise<{
	id: string
	revisionNo: number
	body: string
	meta: unknown
} | null> {
	const [row] = await db
		.select({
			id: documentRevisions.id,
			revisionNo: documentRevisions.revisionNo,
			body: documentRevisions.body,
			meta: documentRevisions.meta,
		})
		.from(documentRevisions)
		.where(eq(documentRevisions.id, id))
	if (!row) return null
	return {
		id: row.id,
		revisionNo: row.revisionNo,
		body: row.body,
		meta: row.meta,
	}
}

/**
 * Restore a revision: write its body+metadata back into the live `documents` row
 * and update the on-disk markdown file.
 *
 * @param id   revision UUID
 * @param opts optional seam for testing — override the chunk-rebuild step so
 *               tests can assert it's invoked without touching embeddings.
 */
export async function restoreRevision(
	id: string,
	opts?: {
		reindex?: (slug: string) => Promise<number>
	},
): Promise<{ slug: string; documentId: string } | null> {
	const [rev] = await db
		.select({
			id: documentRevisions.id,
			documentId: documentRevisions.documentId,
			slug: documentRevisions.slug,
			title: documentRevisions.title,
			body: documentRevisions.body,
			meta: documentRevisions.meta,
		})
		.from(documentRevisions)
		.where(eq(documentRevisions.id, id))
	if (!rev) return null

	const m = rev.meta as {
		type?: string
		section?: string
		status?: string
		author?: string
		tags?: string[]
	}

	const [docRow] = await db
		.select({ path: documents.path })
		.from(documents)
		.where(eq(documents.id, rev.documentId))

	await db
		.update(documents)
		.set({
			title: rev.title,
			type: (m.type as any) ?? "documentation",
			section: (m.section as any) ?? "docs",
			status: (m.status as any) ?? "published",
			author: m.author ?? "",
			tags: m.tags ?? [],
			body: rev.body,
			updatedAt: new Date(),
		})
		.where(eq(documents.id, rev.documentId))

	// Sync back to disk (source of truth for file-based reads)
	if (docRow?.path) {
		const absPath = join(CONTENT_ROOT, docRow.path)
		try {
			const { stringifyFile } = await import("@mcpedia/parser")
			stringifyFile(
				absPath,
				docRow.path,
				{
					id: rev.slug,
					slug: rev.slug,
					title: rev.title,
					type: (m.type as any) ?? "documentation",
					section: (m.section as any) ?? "docs",
					status: (m.status as any) ?? "published",
					author: m.author ?? "",
					tags: m.tags ?? [],
					path: docRow.path,
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString(),
				},
				rev.body,
			)
		} catch (err) {
			console.error(
				`restoreRevision: failed to write file to disk for ${rev.slug}:`,
				err,
			)
		}
	}

	// Rebuild semantic chunks + embeddings from the restored body so semantic
	// and hybrid search stay consistent (otherwise document_chunks would hold
	// the NEW body's chunks while documents.body holds the OLD/restore body).
	const reindex = opts?.reindex ?? reindexChunks
	await reindex(rev.slug)

	return { slug: rev.slug, documentId: rev.documentId }
}
