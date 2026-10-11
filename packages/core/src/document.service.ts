import { and, eq, sql, desc } from "drizzle-orm"
import { db } from "@mcpedia/db"
import {
	documentChunks,
	documentRevisions,
	documents,
} from "@mcpedia/db/schema"
import { CONTENT_ROOT, DEFAULT_SECTIONS, getSectionMeta } from "@mcpedia/config"
import { parseFile } from "@mcpedia/parser"
import { existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import type {
	Document,
	DocumentMeta,
	DocSection,
	DocType,
	DocStatus,
	SectionInfo,
} from "@mcpedia/types"
import {
	chunkText,
	embedChunks,
	createEmbeddingProvider,
} from "@mcpedia/embeddings"
import { readContentFile } from "./content.service"
import { toMeta } from "./row-map"
import { snapshotRevision } from "./index.service"

const embedder = createEmbeddingProvider()

/**
 * List all active sections dynamically from the database, including document counts.
 */
export async function listSections(): Promise<SectionInfo[]> {
	const rows = await db
		.select({
			section: documents.section,
			count: sql<number>`count(*)::int`,
			latestUpdate: sql<string>`max(${documents.updatedAt})::text`,
		})
		.from(documents)
		.where(eq(documents.status, "published"))
		.groupBy(documents.section)
		.orderBy(sql`count(*) desc`)

	if (rows.length === 0) {
		return DEFAULT_SECTIONS.map((s) => ({
			...s,
			docCount: 0,
		}))
	}

	return rows.map((r) => {
		const meta = getSectionMeta(r.section, r.count)
		return {
			...meta,
			docCount: r.count,
			updatedAt: r.latestUpdate,
		}
	})
}

/**
 * List documents from the database, optionally filtered by section or status.
 */
export async function listDocuments(
	opts: { section?: string; status?: string } = {},
): Promise<DocumentMeta[]> {
	const status = opts.status ?? "published"
	const where = [eq(documents.status, status)]
	if (opts.section) where.push(eq(documents.section, opts.section))
	const rows = await db
		.select()
		.from(documents)
		.where(and(...where))
		.orderBy(desc(documents.updatedAt))
	return rows.map(toMeta)
}

/**
 * Fetch a single document directly from PostgreSQL (primary data store).
 */
export async function getDocument(slug: string): Promise<Document | null> {
	const [row] = await db
		.select()
		.from(documents)
		.where(eq(documents.slug, slug))
	if (!row) return null

	let body = row.body
	// Fallback to disk only if DB body is empty (e.g. during initial migration)
	if (!body) {
		const abs = join(CONTENT_ROOT, row.path)
		if (existsSync(abs)) {
			const parsed = parseFile(abs, row.path)
			body = parsed.body
		}
	}

	return { ...toMeta(row), body }
}

/**
 * Find related documents sharing tags with the given slug.
 */
export async function getRelated(
	slug: string,
	limit = 5,
): Promise<DocumentMeta[]> {
	const [row] = await db
		.select({ tags: documents.tags })
		.from(documents)
		.where(eq(documents.slug, slug))
	if (!row || row.tags.length === 0) return []

	const arrLit = sql`ARRAY[${sql.join(
		row.tags.map((t) => sql.param(t)),
		sql`, `,
	)}]::text[]`
	const related = await db
		.select()
		.from(documents)
		.where(
			and(
				eq(documents.status, "published"),
				sql`${documents.tags} && ${arrLit}`,
			),
		)
		.limit(limit + 1)
	return related
		.filter((d) => d.slug !== slug)
		.map(toMeta)
		.slice(0, limit)
}

export { readContentFile }

/**
 * Chunk a document body, embed the chunks, and upsert them into
 * `document_chunks` (replacing any prior chunks for the same slug).
 */
export async function indexChunks(slug: string, body: string): Promise<number> {
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

	// Replace existing chunks for this doc in one transaction.
	await db.delete(documentChunks).where(eq(documentChunks.slug, slug))
	await db.insert(documentChunks).values(
		chunks.map((content: string, i: number) => ({
			documentId: doc.id,
			slug,
			chunkIndex: i,
			content,
			embedding: vectors[i],
		})),
	)
	return chunks.length
}

// ---------------------------------------------------------------------------
// Dynamic CRUD operations (Database-First)
// ---------------------------------------------------------------------------

export interface CreateDocInput {
	slug: string
	title: string
	section: DocSection
	body: string
	type?: DocType
	status?: DocStatus
	author?: string
	tags?: string[]
	extraFields?: Record<string, unknown>
}

export interface UpdateDocInput {
	title?: string
	body?: string
	section?: DocSection
	type?: DocType
	status?: DocStatus
	tags?: string[]
	author?: string
	extraFields?: Record<string, unknown>
}

/** Validate that a slug is safe (no path traversal, only [a-z0-9/_-]). */
function validateSlug(slug: string): string {
	if (!/^[a-z0-9][a-z0-9/_-]*$/.test(slug)) {
		throw new Error(`invalid slug: ${slug}`)
	}
	if (slug.includes("//"))
		throw new Error(`invalid slug (double slash): ${slug}`)
	return slug
}

/** Compute the relative file path for a slug. */
function slugToRelPath(section: DocSection, slug: string): string {
	const cleanSlug = validateSlug(slug)
	const pathPart = cleanSlug.startsWith(`${section}/`)
		? cleanSlug.slice(section.length + 1)
		: cleanSlug
	return `${section}/${pathPart}.md`
}

/**
 * Create a new document in the PostgreSQL database, snapshot revision, and index chunks.
 */
export async function createDocument(
	input: CreateDocInput,
): Promise<DocumentMeta> {
	const section = (input.section || "docs").trim()
	const slug = validateSlug(input.slug)
	const relPath = slugToRelPath(section, slug)

	const [existing] = await db
		.select({ id: documents.id })
		.from(documents)
		.where(eq(documents.slug, slug))
	if (existing) {
		throw new Error(`document already exists at slug: ${slug}`)
	}

	const nowIso = new Date().toISOString()
	const meta: DocumentMeta = {
		id: slug,
		slug,
		title: input.title,
		type: input.type ?? "documentation",
		section,
		status: input.status ?? "published",
		author: input.author ?? "",
		tags: input.tags ?? [],
		path: relPath,
		createdAt: nowIso,
		updatedAt: nowIso,
		extraFields: input.extraFields ?? {},
	}

	// Upsert to DB directly
	await db.insert(documents).values({
		id: meta.id,
		slug: meta.slug,
		title: meta.title,
		type: meta.type,
		section: meta.section,
		status: meta.status,
		author: meta.author,
		tags: meta.tags,
		path: meta.path,
		body: input.body,
		extraFields: input.extraFields ?? {},
		createdAt: new Date(meta.createdAt),
		updatedAt: new Date(meta.updatedAt),
	})

	// Snapshot revision + index chunks
	await snapshotRevision(slug, meta, input.body, "create")
	try {
		await indexChunks(slug, input.body)
	} catch (err) {
		console.error(
			`createDocument: chunk/embed FAILED for ${slug}: ${err instanceof Error ? err.message : err}`,
		)
	}

	// Safe optional disk file sync
	try {
		const absPath = join(CONTENT_ROOT, relPath)
		const { stringifyFile } = await import("@mcpedia/parser")
		stringifyFile(absPath, relPath, meta, input.body)
	} catch (fsErr) {
		// Non-fatal
	}

	return meta
}

/**
 * Update an existing document in PostgreSQL, snapshot revision, and reindex chunks.
 */
export async function updateDocument(
	slug: string,
	input: UpdateDocInput,
): Promise<DocumentMeta> {
	const doc = await getDocument(slug)
	if (!doc) throw new Error(`document not found: ${slug}`)

	const updatedAt = new Date().toISOString()
	const updated: DocumentMeta = {
		...doc,
		title: input.title ?? doc.title,
		type: input.type ?? doc.type,
		section: input.section ?? doc.section,
		status: input.status ?? doc.status,
		tags: input.tags ?? doc.tags,
		author: input.author ?? doc.author,
		updatedAt,
		extraFields:
			input.extraFields !== undefined
				? { ...doc.extraFields, ...input.extraFields }
				: doc.extraFields,
	}
	const body = input.body ?? doc.body

	// Update DB row directly
	await db
		.update(documents)
		.set({
			title: updated.title,
			type: updated.type,
			section: updated.section,
			status: updated.status,
			author: updated.author,
			tags: updated.tags,
			extraFields: updated.extraFields ?? {},
			body,
			updatedAt: new Date(updatedAt),
		})
		.where(eq(documents.slug, slug))

	// Snapshot revision (if body changed) + reindex chunks
	await snapshotRevision(slug, updated, body, "update")
	try {
		await indexChunks(slug, body)
	} catch (err) {
		console.error(
			`updateDocument: chunk/embed FAILED for ${slug}: ${err instanceof Error ? err.message : err}`,
		)
	}

	// Safe optional disk file sync
	try {
		const absPath = join(CONTENT_ROOT, doc.path)
		const { stringifyFile } = await import("@mcpedia/parser")
		stringifyFile(absPath, doc.path, updated, body)
	} catch (fsErr) {
		// Non-fatal
	}

	return updated
}

/**
 * Delete a document from PostgreSQL, chunks, revisions, and optional disk file.
 */
export async function deleteDocument(
	slug: string,
): Promise<{ deleted: boolean }> {
	const [row] = await db
		.select()
		.from(documents)
		.where(eq(documents.slug, slug))
	if (!row) return { deleted: false }

	// Delete DB rows directly
	await db.delete(documentChunks).where(eq(documentChunks.slug, slug))
	await db
		.delete(documentRevisions)
		.where(eq(documentRevisions.documentId, row.id))
	await db.delete(documents).where(eq(documents.id, row.id))

	// Safe optional disk cleanup
	try {
		const absPath = join(CONTENT_ROOT, row.path)
		if (existsSync(absPath)) unlinkSync(absPath)
	} catch (fsErr) {
		// Non-fatal
	}

	return { deleted: true }
}

// ---------------------------------------------------------------------------
// Hierarchical folder structure helpers (dynamic, slug-driven)
// ---------------------------------------------------------------------------

/**
 * Extract the folder structure for a given section from a list of document slugs/paths.
 */
export function extractFoldersForSection(
	docSlugs: string[],
	section: string,
): string[] {
	const folders = new Set<string>()
	const base = `${section}/`
	const cleanSlugs = docSlugs.map((s) => s.replace(/\.md$/, ""))

	for (const slug of cleanSlugs) {
		if (!slug.startsWith(base)) continue
		const rel = slug.slice(base.length)
		const parts = rel.split("/")

		let acc = ""
		for (let i = 0; i < parts.length - 1; i++) {
			acc = acc ? `${acc}/${parts[i]}` : parts[i]
			folders.add(acc)
		}
	}

	return [...folders].sort()
}

/**
 * Determine if a path represents a folder or a leaf document.
 */
export function classifyPath(
	docSlugs: string[],
	path: string,
): "doc" | "folder" | "none" {
	const cleanPath = path.replace(/\.md$/, "")
	const cleanSlugs = docSlugs.map((s) => s.replace(/\.md$/, ""))

	// Check leaf doc match
	if (cleanSlugs.includes(cleanPath)) return "doc"

	// Check folder parent match
	const prefix = `${cleanPath}/`
	if (cleanSlugs.some((s) => s.startsWith(prefix))) return "folder"

	return "none"
}
