/**
 * Row → domain mapping.
 *
 * ## WHY toMeta MOVED HERE
 *
 * It used to live in `@mcpedia/search` and be re-exported from here, which made
 * row mapping depend on the retrieval package. When hindsight replaced the FTS
 * and cosine stack, `@mcpedia/search` had exactly one reason to keep existing:
 * this function. Moving it here makes the deletion honest — a row mapper has no
 * business in a search engine, and leaving it behind would have kept a dead
 * package alive for no reason.
 *
 * The body is unchanged from the version that lived in packages/search: the
 * same fields, the same fallbacks, and the same spread of `extraFields` for the
 * dynamic CTF columns.
 */
import type { DocumentRow } from "@mcpedia/db/schema"
import type { DocStatus, DocumentMeta } from "@mcpedia/types"

/** Map a Drizzle row onto the domain's `DocumentMeta`. */
export function toMeta(row: DocumentRow): DocumentMeta {
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
		// Spread dynamic extra fields (CTF: event, challenge, category,
		// difficulty, points, etc.)
		...extra,
	}
}

export type { DocumentRow }
