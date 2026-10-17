export type DocSection = string
export type DocType = string
export type DocStatus = "published" | "draft" | string

export interface SectionInfo {
	id: string
	label: string
	icon: string
	desc: string
	docCount: number
	updatedAt?: string
}

/**
 * A row of the section REGISTRY — the metadata record itself.
 *
 * Distinct from SectionInfo, which is a registry row JOINED with live document
 * counts. Keeping them apart matters because the two have different writers:
 * SectionRecord is content an operator edits (it is what the MCP
 * `upsert_section` tool and the API's write path accept), while SectionInfo's
 * docCount is derived from the documents table on every read and must never be
 * sent back.
 */
export interface SectionRecord {
	id: string
	label: string
	icon: string
	desc: string
	/** Header nav order. Lower sorts first. */
	sortOrder: number
	/** Omitted from the header nav when true; its URL still resolves. */
	hidden: boolean
}

export interface DocumentMeta {
	id: string // slug
	slug: string
	title: string
	type: DocType
	section: DocSection
	status: DocStatus
	author: string
	tags: string[]
	path: string // relative path under content/
	createdAt: string // ISO
	updatedAt: string // ISO
	// Dynamic custom frontmatter fields (e.g. CTF: event, challenge, category,
	// difficulty, points). Content creators add arbitrary key-value pairs.
	// Values can be strings, numbers, booleans, arrays, or objects.
	extraFields?: Record<string, unknown>
	[key: string]: unknown
}

export interface Document extends DocumentMeta {
	body: string // markdown body
}

export interface SearchHit {
	doc: DocumentMeta
	rank: number
	snippet: string
}

export type ExportSortOption =
	| "category_points"
	| "path"
	| "title"
	| "points_desc"
	| "difficulty"
	| "updated_at"

export interface ExportCategorySummary {
	name: string
	count: number
	points: number
}

export interface ExportSummary {
	title: string
	scope: string
	section: string
	/**
	 * The section's display name, resolved server-side from the registry.
	 *
	 * Sent rather than looked up in the browser because section names now live
	 * in the `sections` table; the PDF view used to call a hardcoded
	 * getSectionMeta() that could not know about a rename. Falls back to the
	 * title-cased section id when no registry row exists.
	 */
	sectionLabel: string
	totalDocuments: number
	totalPoints: number
	categories: ExportCategorySummary[]
	authors: string[]
	generatedAt: string
}

export interface ExportData {
	summary: ExportSummary
	documents: Document[]
}

export interface ExportQueryOptions {
	path?: string
	section?: string
	slugs?: string[]
	status?: string
	sortBy?: ExportSortOption
}
