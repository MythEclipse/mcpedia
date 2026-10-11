/**
 * Drizzle-backed implementation of the document repository.
 *
 * ## WHAT THIS LAYER IS FOR
 *
 * Everything here knows about SQL, table names, column names and the Postgres
 * dialect. Nothing above it does. The application layer asked for "the
 * documents in section X"; this file is the only place that knows that means
 * `select().from(documents).where(eq(documents.section, X))`.
 *
 * ## WHY THE ROW SHAPE NEVER ESCAPES
 *
 * Every method maps its rows through `toMeta` before returning. A caller in
 * application/ receives `DocumentMeta` — the domain entity — and never a Drizzle
 * row. That is what lets the ORM be swapped, and more practically it is what
 * stops a `Date` leaking out as a `Date` where the rest of the codebase has
 * agreed on ISO strings. The entity is the contract; the row is an
 * implementation detail of this file.
 */
import { and, desc, eq, sql, like, or } from "drizzle-orm"
import { db } from "@mcpedia/db"
import {
	documentChunks,
	documentRevisions,
	documents,
	type DocumentRow,
} from "@mcpedia/db/schema"
import { toMeta } from "@mcpedia/search"
import { CONTENT_ROOT } from "@mcpedia/config"
import { readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type {
	CreateDocInput,
	Document,
	DocumentMeta,
	DocumentRepository,
} from "../domain"

export function createDocumentRepository(
	client: typeof db = db,
): DocumentRepository {
	return {
		async list(opts = {}) {
			const status = opts.status ?? "published"
			const where = [eq(documents.status, status)]
			if (opts.section) where.push(eq(documents.section, opts.section))
			const rows = await client
				.select()
				.from(documents)
				.where(and(...where))
				.orderBy(desc(documents.updatedAt))
			return rows.map(toMeta)
		},

		async getBySlug(slug) {
			const [row] = await client
				.select()
				.from(documents)
				.where(eq(documents.slug, slug))
			if (!row) return null
			return { ...toMeta(row), body: row.body ?? "" }
		},

		async getRelated(slug, limit) {
			const [row] = await client
				.select({ tags: documents.tags })
				.from(documents)
				.where(eq(documents.slug, slug))
			if (!row || row.tags.length === 0) return []

			// A text[] overlap test, built from the row's own tags as bound
			// parameters. Interpolating them as a literal would be an injection
			// point: a tag containing a quote would rewrite the statement.
			const arrLit = sql`ARRAY[${sql.join(
				row.tags.map((t) => sql.param(t)),
				sql`, `,
			)}]::text[]`

			const related = await client
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
		},

		async listSections() {
			const rows = await client
				.select({
					section: documents.section,
					count: sql<number>`count(*)::int`,
					latestUpdate: sql<string>`max(${documents.updatedAt})::text`,
				})
				.from(documents)
				.where(eq(documents.status, "published"))
				.groupBy(documents.section)
				.orderBy(sql`count(*) desc`)
			return rows.map((r) => ({
				section: r.section,
				count: r.count,
				latestUpdate: r.latestUpdate,
			}))
		},

		async insert(input: CreateDocInput & { path: string; meta: DocumentMeta }) {
			const { meta } = input
			await client.insert(documents).values({
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
		},

		async update(slug: string, updated: DocumentMeta, body: string) {
			await client
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
					updatedAt: new Date(updated.updatedAt),
				})
				.where(eq(documents.slug, slug))
		},

		async remove(slug: string) {
			const [row] = await client
				.select()
				.from(documents)
				.where(eq(documents.slug, slug))
			if (!row) return { deleted: false }

			// Chunks and revisions first: both reference the document, so
			// deleting them after the parent leaves dangling rows.
			await client.delete(documentChunks).where(eq(documentChunks.slug, slug))
			await client
				.delete(documentRevisions)
				.where(eq(documentRevisions.documentId, row.id))
			await client.delete(documents).where(eq(documents.id, row.id))

			return { deleted: true }
		},

		async upsertFromFile({ meta, body, updatedAt }) {
			await client
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
					createdAt: new Date(meta.createdAt || updatedAt),
					updatedAt: new Date(updatedAt),
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
						updatedAt: new Date(updatedAt),
					},
				})
		},

		async listForExport(opts) {
			const status = opts.status ?? "published"
			let rows: DocumentRow[] = []

			if (opts.slugs && opts.slugs.length > 0) {
				rows = await client
					.select()
					.from(documents)
					.where(
						and(
							eq(documents.status, status),
							sql`${documents.slug} IN ${opts.slugs}`,
						),
					)
			} else if (opts.path) {
				const cleanPath = opts.path.replace(/^\/+|\/+$/g, "")

				// Exact match first: a folder can share a name with a leaf
				// document ("notes" and "notes.md"), and the document is the
				// more specific request.
				const exactMatch = await client
					.select()
					.from(documents)
					.where(
						and(eq(documents.status, status), eq(documents.slug, cleanPath)),
					)

				if (exactMatch.length === 1 && exactMatch[0]) {
					rows = exactMatch
				} else {
					rows = await client
						.select()
						.from(documents)
						.where(
							and(
								eq(documents.status, status),
								or(
									eq(documents.slug, cleanPath),
									like(documents.slug, `${cleanPath}/%`),
									eq(documents.section, cleanPath),
								),
							),
						)
				}
			} else if (opts.section) {
				rows = await client
					.select()
					.from(documents)
					.where(
						and(
							eq(documents.status, status),
							eq(documents.section, opts.section),
						),
					)
			} else {
				rows = await client
					.select()
					.from(documents)
					.where(eq(documents.status, status))
			}

			return rows.map((r) => ({ ...toMeta(r), body: r.body ?? "" }))
		},

		async readContentFile(relPath: string) {
			const { readFileSync } = await import("node:fs")
			return readFileSync(join(CONTENT_ROOT, relPath), "utf8")
		},

		async listContentFiles() {
			const out: string[] = []
			const walk = (dir: string) => {
				for (const entry of readdirSync(dir)) {
					const full = join(dir, entry)
					const st = statSync(full)
					if (st.isDirectory()) walk(full)
					else if (/\.mdx?$/.test(entry)) out.push(relative(CONTENT_ROOT, full))
				}
			}
			walk(CONTENT_ROOT)
			return out
		},
	}
}
