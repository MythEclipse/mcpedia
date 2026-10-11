/**
 * /export/pdf — the print/PDF export page.
 *
 * Ported from apps/web/app/export/pdf/page.tsx. The one change with teeth:
 * that page imported `getExportDocuments` from @mcpedia/core and called it in
 * an async server component; this one calls `documents.export` over oRPC from a
 * loader. That is the whole reason the page can exist in a browser bundle at
 * all — @mcpedia/core is denied at build time by src/build/no-server-imports.
 *
 * PRINTING IS UNCHANGED: PdfExportView still calls window.print(). There is no
 * headless browser and no server-side PDF generation anywhere in this route —
 * the browser's own print dialog is the mechanism, exactly as before. What makes
 * the printed output correct is the @media print block in app/globals.css, which
 * src/styles.css imports.
 *
 * PARAMETERS. `path`, `section` and `slug` were already in the wild — the slug
 * page links here with them — so their names and precedence are preserved
 * exactly; see src/routes/export-pdf-params.ts, which is where that logic lives
 * and where it is tested. `validateSearch` coerces and narrows them at the
 * router boundary, so a hand-edited ?sort=nonsense cannot reach the API.
 */
import { ArrowLeft, FileText } from "lucide-react"
import { fetchExportData } from "../lib/orpc"
import {
	resolveExportRequest,
	type ExportPdfSearch,
	type ExportPdfRequest,
} from "./export-pdf-params"
import type { ExportData } from "@mcpedia/types"
import PdfExportView from "../components/PdfExportView"

/**
 * Coerce raw query values to the strings the route expects.
 *
 * TanStack parses search params as JSON, so ?sort=title arrives as a string but
 * ?path=123 arrives as a NUMBER. Without this, a numeric-looking slug would be
 * typed as string and then fail every `.replace()` in resolveExportRequest.
 */
export function asString(value: unknown): string | undefined {
	if (typeof value === "string") return value
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value)
	}
	return undefined
}

/** Search-param validation, applied by the router before the loader runs. */
export function validateExportSearch(
	search: Record<string, unknown>,
): ExportPdfSearch {
	return {
		path: asString(search.path),
		section: asString(search.section),
		slug: asString(search.slug),
		sort: asString(search.sort),
	}
}

/**
 * Search params the loader actually depends on.
 *
 * Every one of them changes the document set, so all four belong in the cache
 * key. This exists as its own function because it is the rule that decides when
 * /export/pdf refetches, and a rule like that should be testable.
 */
export function exportLoaderDeps(search: ExportPdfSearch): ExportPdfSearch {
	return {
		path: search.path,
		section: search.section,
		slug: search.slug,
		sort: search.sort,
	}
}

/**
 * The loader, exported for src/routes.tsx.
 *
 * WHY THE ROUTE IS BUILT THERE AND NOT HERE: TanStack infers loader-data types
 * from the literal `createRoute({...})` call site and the assembled tree. A
 * route built inside a factory function loses that entirely — `useLoaderData`
 * degrades to `never`, which is not a visible type error but a silently untyped
 * surface. So route modules export their pieces and src/routes.tsx composes the
 * tree from literals.
 */
export async function exportPdfLoader(search: ExportPdfSearch): Promise<{
	request: ExportPdfRequest
	exportData: ExportData
}> {
	const request = resolveExportRequest(search)
	const exportData = await fetchExportData(request)
	return { request, exportData }
}

/** Renders the loaded export, or the empty state when nothing matched. */
export function ExportPdfPage(props: {
	request: ExportPdfRequest
	exportData: ExportData
}) {
	const { request, exportData } = props
	// The page decides "empty" from the document list core returned. core keeps a
	// single document named `index` on purpose (a lone `index` can be a real
	// document); PdfExportView applies the stricter filter. Checking the raw
	// length here would render an export view holding zero articles instead of
	// the explanatory empty state.
	const docs = exportData.documents ?? []
	if (docs.length === 0) {
		return <ExportEmptyState request={request} />
	}
	return <PdfExportView exportData={exportData} backHref={request.backHref} />
}

/** The "nothing matched" panel. Ported from the Next page's early return. */
function ExportEmptyState({
	request,
}: {
	request: ReturnType<typeof resolveExportRequest>
}) {
	return (
		<div className="py-16 text-center space-y-4 max-w-lg mx-auto bg-[var(--bg-surface)] border border-[var(--border-color)] rounded-3xl p-8 shadow-sm">
			<div className="w-14 h-14 rounded-2xl bg-[var(--bg-elevated)] text-[var(--text-dim)] flex items-center justify-center mx-auto">
				<FileText className="w-7 h-7" />
			</div>
			<h1 className="text-2xl font-bold text-[var(--text-primary)]">
				No Documents Found for Export
			</h1>
			<p className="text-xs sm:text-sm text-[var(--text-muted)] leading-relaxed">
				Could not find any published documents matching the path{" "}
				<code className="text-[var(--brand)] dark:text-[var(--accent)] font-mono font-semibold">
					{request.scopeLabel}
				</code>
				.
			</p>
			<div className="pt-4">
				{/*
				 A plain <a>, not TanStack's <Link to="/">. The destination routes
				 are owned by other port groups and do not exist in this tree yet,
				 and TanStack types `to` against the registered tree — so a Link
				 here would fail typecheck until every group is merged. A full
				 page load to "/" is correct in the interim and is upgraded to a
				 Link when the index route lands. Same reasoning in dashboard.tsx.
				*/}
				<a
					href={request.backHref || "/"}
					className="inline-flex items-center gap-1.5 px-4 py-2 bg-[var(--brand)] hover:bg-[var(--brand-hover)] text-white text-xs font-semibold rounded-xl shadow-md shadow-[var(--brand)]/20 transition-all"
				>
					<ArrowLeft className="w-3.5 h-3.5" />
					<span>Return to Knowledge Base</span>
				</a>
			</div>
		</div>
	)
}
