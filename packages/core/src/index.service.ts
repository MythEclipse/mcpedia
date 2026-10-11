import { db } from "@mcpedia/db"
import {
	documents,
	documentRevisions,
	documentChunks,
} from "@mcpedia/db/schema"
import { parseFile } from "@mcpedia/parser"
import { CONTENT_ROOT } from "@mcpedia/config"
import { listContentFiles } from "./content.service"
import { indexChunks } from "./document.service"
import { toMeta } from "./row-map"
import { eq, desc, and, sql } from "drizzle-orm"
import { join } from "node:path"

export interface IndexResult {
	indexed: number
	chunks: number
	revisions: number
}

/**
 * Index a single content file: parse → upsert `documents` → chunk+embed →
 * snapshot a revision if the body changed since the last indexed revision.
 *
 * This is THE single indexing entry point shared by the CLI script, the
 * BullMQ worker, and the git-sync hook — no business logic is duplicated.
 *
 * @param relPath path relative to CONTENT_ROOT (e.g. "docs/websocket/contract")
 * @param reason  provenance tag for the revision ("index" | "git-push" | "reindex")
 */
export async function indexContentFile(
	relPath: string,
	reason = "index",
): Promise<{ indexed: boolean; chunks: number; revision: boolean }> {
	const abs = join(CONTENT_ROOT, relPath)
	const { meta, body } = parseFile(abs, relPath)
	const nowIso =
		meta.updatedAt && meta.updatedAt !== ""
			? meta.updatedAt
			: new Date().toISOString()

	await db
		.insert(documents)
		.values({
			id: meta.id,
			slug: meta.slug,
			title: meta.title,
			type: meta.type,
			section: meta.section,
			status: meta.status,
			author: meta.author,
			tags: meta.tags,
			path: meta.path,
			body,
			extraFields: meta.extraFields ?? {},
			createdAt: new Date(meta.createdAt || nowIso),
			updatedAt: new Date(nowIso),
		})
		.onConflictDoUpdate({
			target: documents.slug,
			set: {
				title: meta.title,
				type: meta.type,
				section: meta.section,
				status: meta.status,
				author: meta.author,
				tags: meta.tags,
				path: meta.path,
				body,
				extraFields: meta.extraFields ?? {},
				updatedAt: new Date(nowIso),
			},
		})

	// Semantic chunks (embedding). A failure here must not abort the whole
	// index — log and continue; FTS still works without embeddings.
	let chunks = 0
	try {
		chunks = await indexChunks(meta.slug, body)
	} catch (err) {
		console.error(
			`    embed FAILED for ${meta.slug}: ${err instanceof Error ? err.message : err}`,
		)
	}

	// Snapshot a revision only when the body actually changed vs the latest
	// revision. Pure metadata/index changes (tags/title) won't create noise.
	const revision = await snapshotRevision(meta.slug, meta, body, reason)

	return { indexed: true, chunks, revision }
}

/**
 * Pure decision rule for the revision system: create a new revision only when
 * the body genuinely changed vs the latest snapshot.
 * - no prior revision (latestBody null)  -> true  (first snapshot)
 * - identical body                      -> false (no noise)
 * - different body                      -> true
 *
 * Exported separately so it can be unit-tested without a database.
 */
export function shouldCreateRevision(
	latestBody: string | null | undefined,
	body: string,
): boolean {
	return latestBody == null || latestBody !== body
}

/**
 * Compare the incoming body against the latest revision's body; if different
 * (or no prior revision exists), create a new revision with an incremented
 * per-document revisionNo.
 */
export async function snapshotRevision(
	slug: string,
	meta: ReturnType<typeof parseFile>["meta"],
	body: string,
	reason: string,
): Promise<boolean> {
	const [doc] = await db
		.select({ id: documents.id })
		.from(documents)
		.where(eq(documents.slug, slug))
	if (!doc) return false

	const [latest] = await db
		.select({
			body: documentRevisions.body,
			revisionNo: documentRevisions.revisionNo,
		})
		.from(documentRevisions)
		.where(eq(documentRevisions.documentId, doc.id))
		.orderBy(desc(documentRevisions.revisionNo))
		.limit(1)

	if (latest && latest.body === body) {
		return false // unchanged → no new revision
	}

	const nextNo = (latest?.revisionNo ?? 0) + 1
	await db.insert(documentRevisions).values({
		documentId: doc.id,
		slug,
		revisionNo: nextNo,
		title: meta.title,
		body,
		meta: {
			type: meta.type,
			section: meta.section,
			status: meta.status,
			author: meta.author,
			tags: meta.tags,
		},
		reason,
	})
	return true
}

/**
 * Rebuild the semantic chunks + embeddings for a slug from its CURRENT live
 * `documents.body`. Used after `restoreRevision` so semantic/hybrid search
 * stay consistent with the restored body (otherwise chunks would be stale).
 * Embed failures are logged, not thrown — FTS remains the source of truth.
 */
export async function reindexChunks(slug: string): Promise<number> {
	const [doc] = await db
		.select({ body: documents.body })
		.from(documents)
		.where(eq(documents.slug, slug))
	if (!doc) return 0
	try {
		return await indexChunks(slug, doc.body)
	} catch (err) {
		console.error(
			`    reindexChunks embed FAILED for ${slug}: ${err instanceof Error ? err.message : err}`,
		)
		return 0
	}
}

/**
 * Walk the entire content tree and index every file. Returns aggregate counts.
 */
export async function runFullIndex(reason = "index"): Promise<IndexResult> {
	const files = listContentFiles()
	let indexed = 0
	let chunks = 0
	let revisions = 0
	for (const rel of files) {
		const r = await indexContentFile(rel, reason)
		indexed++
		chunks += r.chunks
		if (r.revision) revisions++
		console.log(
			`  indexed ${rel}${r.chunks ? ` (${r.chunks} chunks)` : ""}${r.revision ? " [revision]" : ""}`,
		)
	}
	console.log(
		`indexed ${indexed} documents, ${chunks} chunks, ${revisions} new revisions`,
	)
	return { indexed, chunks, revisions }
}
