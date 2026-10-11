/**
 * Export use case: fetch every document a caller asked for, bodies included.
 *
 * ## WHY THE RENDERING IS NOT HERE
 *
 * `compileExportMarkdown` and `generateExportDocx` are reused AS-IS from the
 * package's existing export helpers, and they stay where they are: the DOCX and
 * Markdown renderers are presentation concerns, and the web app imports
 * `export-helpers` directly in the browser. Moving them behind a port would put
 * a pure formatter behind a factory for no benefit and would break the
 * browser-safe entry point that the /export/pdf page depends on.
 *
 * What IS here is the part that touches storage: choosing which documents an
 * export covers, filling in bodies that were never indexed, dropping the
 * meta-index pages, and ordering the result.
 */
import { buildExportSummary, sortExportDocuments } from "./export.helpers"
import type {
	ContentMirror,
	Document,
	ExportData,
	ExportQueryOptions,
} from "../domain"

type ExportOptions = ExportQueryOptions

/** The subset of the document repository an export needs. */
export interface ExportDocumentSource {
	listForExport(opts: ExportQueryOptions): Promise<Document[]>
}

export interface ExportDeps {
	documents: ExportDocumentSource
	mirror?: ContentMirror
}

/**
 * Meta pages that exist to index a directory rather than to be read.
 *
 * They are dropped ONLY when more than one document is in the set. A deliberate
 * single-document export of something named `index` should still work — the
 * rule protects a folder export from including its own table of contents, and
 * it would be wrong to refuse a direct request.
 */
function isMetaPage(doc: Document): boolean {
	const slug = doc.slug.toLowerCase()
	return (
		slug.endsWith("/_index") ||
		slug.endsWith("/index") ||
		slug === "_index" ||
		slug === "index" ||
		doc.type === "writeup-index"
	)
}

/**
 * Fetch all documents for export with full bodies, sorted and summarized.
 *
 * A body that is empty in the database falls back to the on-disk file, for the
 * same reason `getDocument` does: a row created by a migration carries no body
 * until the first index run. Unlike the single-document read, an export cannot
 * quietly return an empty document — the caller asked for a printable artefact,
 * so a body that cannot be recovered becomes "" and the caller sees a blank
 * section rather than a silently missing one.
 */
export function makeGetExportDocuments(deps: ExportDeps) {
	const { documents, mirror } = deps

	return async function getExportDocuments(
		opts: ExportQueryOptions = {},
	): Promise<ExportData> {
		const sortBy = opts.sortBy ?? "category_points"
		const rows = await documents.listForExport(opts)

		const loaded: Document[] = await Promise.all(
			rows.map(async (row) => {
				if (row.body) return { ...row, body: row.body }
				if (!mirror) return { ...row, body: "" }
				try {
					return { ...row, body: await mirror.read(row.path) }
				} catch {
					return { ...row, body: "" }
				}
			}),
		)

		let filtered = loaded
		if (loaded.length > 1) {
			const withoutIndex = loaded.filter((d) => !isMetaPage(d))
			if (withoutIndex.length > 0) filtered = withoutIndex
		}

		const sorted = sortExportDocuments(filtered, sortBy)
		const summary = buildExportSummary(sorted, opts.path, opts.section)

		return { summary, documents: sorted }
	}
}

export type { ExportData, ExportOptions }
