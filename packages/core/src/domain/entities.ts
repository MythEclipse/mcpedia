/**
 * Entities: the data the domain reasons about, and the inputs its use cases
 * accept.
 *
 * ## WHY MOST OF THIS IS `import type`
 *
 * Every type here comes from @mcpedia/types, which is a pure type package with
 * no runtime code. Re-declaring `Document` or `SectionInfo` would create a
 * second definition that drifts from the one the database layer maps onto, and
 * a drift between "what the domain says a Document is" and "what the row
 * mapper produces" is precisely the bug class this reorg exists to prevent.
 *
 * So this module re-EXPORTS the canonical types rather than restating them.
 * That keeps one definition, in one place, and still gives the application and
 * presentation layers a single import site that points at the domain.
 *
 * The one type that IS declared here is `DocumentRepository`: an interface in
 * the domain that the infrastructure layer implements. That is the entire
 * dependency-inversion seam, and it is described in repositories.ts.
 */
import type {
	Document,
	DocumentMeta,
	ExportData,
	ExportQueryOptions,
	SearchHit,
	SectionInfo,
	SectionRecord,
} from "@mcpedia/types"

export type {
	Document,
	DocumentMeta,
	ExportData,
	ExportQueryOptions,
	SearchHit,
	SectionInfo,
	SectionRecord,
}

/** A single revision's metadata, as returned by the revision history. */
export interface RevisionSummary {
	id: string
	slug: string
	revisionNo: number
	title: string
	reason: string
	createdAt: string
	bodyLength: number
}

/**
 * A revision's full body plus the snapshot metadata it was taken with.
 *
 * `title` is carried separately from `meta` because it is a real column on
 * `document_revisions` and NOT part of the metadata blob. A restore needs it:
 * the title is what the document showed when the revision was taken, and it is
 * the one piece of a revision that cannot be recovered from `meta` alone.
 */
export interface RevisionDetail {
	id: string
	revisionNo: number
	title: string
	body: string
	meta: unknown
}

/**
 * The metadata a revision is self-describing with.
 *
 * This shape is also what `document_revisions.meta` is declared as in
 * @mcpedia/db/schema. It lives in the domain so the use case that builds it and
 * the repository that writes it share ONE definition — a second copy is a cast
 * waiting to drift, and a drift there corrupts restore silently.
 */
export interface RevisionMeta {
	type: string
	section: string
	status: string
	author: string
	tags: string[]
}

/** What restoring a revision reports back. */
export interface RestoreResult {
	slug: string
	documentId: string
}

/** Aggregate counts from a full-corpus index run. */
export interface IndexResult {
	indexed: number
	chunks: number
	revisions: number
}

/** What indexing a single file reports back. */
export interface IndexFileResult {
	indexed: boolean
	chunks: number
	revision: boolean
}

/** Inputs to create a document. */
export interface CreateDocInput {
	slug: string
	title: string
	section: string
	body: string
	type?: string
	status?: string
	author?: string
	tags?: string[]
	extraFields?: Record<string, unknown>
}

/** Inputs to update a document. Every field is optional; omitted means unchanged. */
export interface UpdateDocInput {
	title?: string
	body?: string
	section?: string
	type?: string
	status?: string
	tags?: string[]
	author?: string
	extraFields?: Record<string, unknown>
}

/** Which documents to pull for an export, and how to order them. */
export type ExportOptions = ExportQueryOptions

/**
 * The parser port: a markdown file's raw text, turned into metadata + body.
 *
 * Declared here rather than in application/index.use-cases.ts because both the
 * domain-facing barrel and the infrastructure adapter need it, and a port that
 * only one side can name is not a port.
 */
export interface ContentParser {
	parse(input: { relPath: string; raw: string }): {
		meta: DocumentMeta
		body: string
	}
}

/** A markdown content file on disk, and its parsed frontmatter. */
export interface ContentFile {
	/** Path relative to CONTENT_ROOT, e.g. "docs/websocket/contract.md". */
	relPath: string
	raw: string
}

/**
 * Folder classification for one path within a section.
 *
 * This is the answer `classifyPath` produces, bundled with the folder tree so a
 * caller gets everything it needs to render a breadcrumb or a 404 in one read.
 */
export interface FolderInfo {
	classification: "doc" | "folder" | "none"
	folders: string[]
	docCount: number
}
