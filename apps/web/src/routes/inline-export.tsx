/**
 * The inline export view for `/:section/export`, `/:section/<folder>/export`
 * and `/:doc/export`.
 *
 * ## WHAT THIS REPLACES
 *
 * Every "Export PDF" affordance in the app — the section page's hero button, the
 * folder page's hero button, the document toolbar's PDF button — links to a path
 * ending in `/export`. `DocRoute` matched those with `isExportPath` and rendered
 * an EmptyState reading:
 *
 *     "The PDF export view for /writeups is served by the Next route until the
 *      export helpers are ported."
 *
 * The Next route it named had been DELETED with the Next tree. The export
 * helpers were not in fact unported: they are allow-listed for the browser
 * (`@mcpedia/core/export-helpers`), the standalone `/export/pdf` route uses
 * them, and `PdfExportView` renders the whole thing. So the placeholder was
 * stale on both counts — the work was already done, and the thing it deferred to
 * no longer existed.
 *
 * ## WHY A QUERY RATHER THAN A ROUTE LOADER
 *
 * `/export/pdf` is a top-level route with a loader, and it is reached by a real
 * navigation. These paths are reached the same way, so a loader would work too —
 * but the payload is every document's FULL BODY, and the point of splitting this
 * component out is that the same fetch is reusable from anywhere (see
 * `useExportDataQuery`). Keeping it a query means one cache entry per (path,
 * sort) and no second fetch when the user moves between a doc's export and its
 * section's.
 *
 * ## WHY `sortBy` LIVES HERE
 *
 * The route loader's sort comes from `?sort=` in the URL. These paths carry no
 * query string in any existing link, so the default is used — and PdfExportView
 * owns the toolbar that changes it afterwards. Passing the default explicitly
 * rather than omitting the argument keeps the cache key deterministic.
 */
import type { ExportSortOption } from "@mcpedia/types"
import { FileDown } from "lucide-react"
import PdfExportView from "#/components/PdfExportView"
import { EmptyState } from "#/components/EmptyState"
import { useExportDataQuery } from "#/lib/queries"

/** The query the API takes, resolved from a route path. */
export interface InlineExportTarget {
	/** The slug being exported, or undefined for a bare `/export`. */
	path?: string
	/** Where the view's "Back" button goes. */
	backHref: string
}

/**
 * What a `/…/export` path exports, and where "Back" returns to.
 *
 * `exportTargetSlug` (routes/export-pdf-params.ts) does the path arithmetic and
 * is shared with `/export/pdf`, so the two cannot disagree about what
 * `/:docs/setup/export` means. This function only adds the back-link, which is
 * the one thing the two differ on: `/export/pdf` reads it from `?path=`, while
 * an inline export derives it from the path it is already on.
 */
export function inlineExportTarget(
	section: string,
	targetSlug: string | undefined,
): InlineExportTarget {
	return {
		...(targetSlug ? { path: targetSlug } : {}),
		backHref: targetSlug ? `/${targetSlug}` : section ? `/${section}` : "/",
	}
}

export function InlineExport({
	section,
	target,
	sortBy = "category_points",
}: {
	section: string
	target: InlineExportTarget
	sortBy?: ExportSortOption
}) {
	const { data, isPending, error } = useExportDataQuery(
		target.path,
		sortBy,
		true,
	)

	if (isPending) {
		return (
			<div
				className="flex items-center justify-center gap-3 py-16 text-[var(--text-muted)] text-xs font-mono"
				role="status"
				aria-live="polite"
			>
				<div className="w-4 h-4 border-2 border-[var(--text-muted)] border-t-transparent rounded-full animate-spin" />
				<span>Preparing export…</span>
			</div>
		)
	}

	if (error || !data) {
		return (
			<EmptyState
				title="Export unavailable"
				description={
					error instanceof Error
						? error.message
						: `Could not build an export for ${target.path ?? section}.`
				}
			/>
		)
	}

	// A scope with no documents is not an error — an empty section, or a folder
	// that exists but is unpublished, reaches here. Rendering the export view
	// would print a cover page with a zero count, so it gets the explanatory
	// state instead. This mirrors what `/export/pdf` does with the same payload.
	if (data.documents.length === 0) {
		return (
			<EmptyState
				title="Nothing to export"
				description={`No published documents matched ${target.path ?? section}.`}
				icon={FileDown}
			/>
		)
	}

	return <PdfExportView exportData={data} backHref={target.backHref} />
}
