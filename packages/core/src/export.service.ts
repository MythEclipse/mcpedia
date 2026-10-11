import { and, eq, like, or, sql } from "drizzle-orm"
import { db } from "@mcpedia/db"
import { documents, type DocumentRow } from "@mcpedia/db/schema"
import { CONTENT_ROOT } from "@mcpedia/config"
import { parseFile } from "@mcpedia/parser"
import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Document, ExportData, ExportQueryOptions } from "@mcpedia/types"
import { toMeta } from "./row-map"
import { buildExportSummary, sortExportDocuments } from "./export.helpers"

export * from "./export.helpers"
export * from "./export.docx"

/**
 * Fetch all documents for export with full bodies directly from PostgreSQL
 * (with fallback to disk if empty).
 */
export async function getExportDocuments(
	opts: ExportQueryOptions = {},
): Promise<ExportData> {
	const status = opts.status ?? "published"
	const sortBy = opts.sortBy ?? "category_points"

	let rows: DocumentRow[] = []

	if (opts.slugs && opts.slugs.length > 0) {
		// Explicit list of slugs
		rows = await db
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

		// 1. Try exact match for single document
		const exactMatch = await db
			.select()
			.from(documents)
			.where(and(eq(documents.status, status), eq(documents.slug, cleanPath)))

		if (exactMatch.length === 1 && exactMatch[0]) {
			rows = exactMatch
		} else {
			// 2. Try prefix match for folder/event or section
			rows = await db
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
		// Section-wide match
		rows = await db
			.select()
			.from(documents)
			.where(
				and(eq(documents.status, status), eq(documents.section, opts.section)),
			)
	} else {
		// All published documents
		rows = await db.select().from(documents).where(eq(documents.status, status))
	}

	// Map rows to Document with bodies
	const loadedDocs: Document[] = rows.map((row) => {
		let body = row.body
		if (!body) {
			const abs = join(CONTENT_ROOT, row.path)
			if (existsSync(abs)) {
				try {
					const parsed = parseFile(abs, row.path)
					body = parsed.body
				} catch {
					body = ""
				}
			}
		}
		return { ...toMeta(row), body: body || "" }
	})

	// Filter out meta index documents (like _index or index) when exporting multiple docs
	let filteredDocs = loadedDocs
	if (loadedDocs.length > 1) {
		const withoutIndex = loadedDocs.filter((d) => {
			const slug = d.slug.toLowerCase()
			return (
				!slug.endsWith("/_index") &&
				!slug.endsWith("/index") &&
				slug !== "_index" &&
				slug !== "index" &&
				d.type !== "writeup-index"
			)
		})
		if (withoutIndex.length > 0) {
			filteredDocs = withoutIndex
		}
	}

	// Sort neatly
	const sortedDocs = sortExportDocuments(filteredDocs, sortBy)
	const summary = buildExportSummary(sortedDocs, opts.path, opts.section)

	return {
		summary,
		documents: sortedDocs,
	}
}
