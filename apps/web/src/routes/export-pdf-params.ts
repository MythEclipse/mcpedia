/**
 * Query-parameter handling for /export/pdf.
 *
 * Split out of the route component because this is the part with real logic in
 * it, and it is the part that has to stay byte-compatible with the Next page it
 * replaces: the links that reach /export/pdf are already in the wild (the
 * slug page's "Export PDF" button, and hand-shared URLs), so the accepted
 * parameter names and their precedence cannot change.
 *
 * Three inputs existed on the Next page: path, section and slug. `path` and
 * `slug` were used as ALIASES for one another (whichever was truthy won), and
 * `section` was only honoured when neither was present. That precedence is
 * preserved exactly, including the part that is easy to get wrong: when a path
 * IS given, the section parameter is IGNORED rather than intersected, because
 * core's getExportDocuments already resolves a path against every section.
 */
import type { ExportSortOption } from "@mcpedia/types"

/** The six sort modes, in the order the toolbar lists them. */
export const SORT_OPTIONS = [
	"category_points",
	"points_desc",
	"difficulty",
	"title",
	"path",
	"updated_at",
] as const satisfies readonly ExportSortOption[]

export const DEFAULT_SORT: ExportSortOption = "category_points"

/** Raw search params as TanStack Router delivers them (all optional strings). */
export interface ExportPdfSearch {
	path?: string
	section?: string
	slug?: string
	sort?: string
}

/** The resolved request against the API. */
export interface ExportPdfRequest {
	/** Document scope: a path/slug, or undefined to export a whole section. */
	path?: string
	/** Only meaningful when `path` is absent. */
	section?: string
	sortBy: ExportSortOption
	/** Where the empty-state "back" button goes. */
	backHref: string
	/** What the empty state names as the scope that was searched. */
	scopeLabel: string
}

/** Narrow an untrusted `?sort=` to a supported option, falling back to default. */
export function parseSortOption(raw: string | undefined): ExportSortOption {
	if (raw && (SORT_OPTIONS as readonly string[]).includes(raw)) {
		return raw as ExportSortOption
	}
	return DEFAULT_SORT
}

/**
 * Strip surrounding slashes and collapse empties.
 *
 * The Next page did not do this before calling core — it passed the raw value
 * through and core's own `replace(/^\/+|\/+$/g, "")` handled it. Normalising
 * here means `backHref` is built from the SAME string that is sent to the API,
 * so the two cannot disagree about what was requested.
 */
function normalisePath(value: string | undefined): string | undefined {
	if (!value) return undefined
	const clean = value.replace(/^\/+|\/+$/g, "")
	return clean || undefined
}

/**
 * Resolve raw search params into the API request.
 *
 * Precedence, matching the Next page exactly:
 *   1. `path` wins; `slug` is its alias (both are the same field)
 *   2. with no path, `section` selects the scope
 *   3. an unrecognised `sort` falls back rather than 500-ing the page
 */
export function resolveExportRequest(
	search: ExportPdfSearch,
): ExportPdfRequest {
	const path = normalisePath(search.path ?? search.slug)
	const section = normalisePath(search.section)
	const sortBy = parseSortOption(search.sort)

	// A path is resolved by core against every section, so sending `section`
	// alongside it would narrow a result set that is supposed to be global.
	const effectiveSection = path ? undefined : section

	const backHref = path ? `/${path}` : section ? `/${section}` : "/"
	const scopeLabel = path ?? section ?? "root"

	return {
		...(path ? { path } : {}),
		...(effectiveSection ? { section: effectiveSection } : {}),
		sortBy,
		backHref,
		scopeLabel,
	}
}

/**
 * Drop the leftover index/meta files the export view must not render.
 *
 * core already filters these out when it returns more than one document, but it
 * deliberately keeps them when it returns exactly one — because a single
 * document legitimately named `index` is a real document, and blanking the page
 * would be wrong. PdfExportView applies the same filter again so a single-doc
 * export of an index file still renders as an empty state rather than printing
 * a table of contents nobody asked for. Ported verbatim.
 */
export function isExportableDocument(doc: {
	slug: string
	type?: string
}): boolean {
	const slug = doc.slug.toLowerCase()
	return !(
		slug.endsWith("/_index") ||
		slug.endsWith("/index") ||
		slug === "_index" ||
		slug === "index" ||
		doc.type === "writeup-index"
	)
}
