/**
 * Client-side .docx export.
 *
 * ## WHY THIS IS CLIENT-SIDE, AND WHY THAT IS NOT A COMPROMISE
 *
 * This replaces the Next app's `/api/export?format=docx` route, which was
 * deleted with the Next tree. DocActions still linked to it, so the "Word
 * (.docx)" button on every document fetched the SPA's HTML catch-all and
 * downloaded a text/html page named `...&format=docx` — a silent 200, not an
 * error. Meanwhile the export toolbar's .docx button was disabled outright with
 * a title saying the route "still runs on the Next app".
 *
 * The `docx` package cannot run on a server only: it is a pure, synchronous
 * OpenXML writer with no Node API surface, and `Packer` already ships `toBlob`
 * for browsers. Verified by probe rather than assumed — bundling
 * `packages/core/src/application/export.docx.ts` for `platform: "browser"`
 * yields a bundle with ZERO `node:` imports and ZERO `require(` calls, and
 * calling the REAL `generateExportDocx` on real ExportData returns a valid
 * `PK`-signature zip. So the whole build runs in the tab and nothing needs to
 * be added to the API or to Caddy.
 *
 * The build is ~860 KB of JS, so it is imported DYNAMICALLY and only when the
 * user actually clicks export. A static import would add that to the entry
 * chunk for every visitor, including the ones who only read documents.
 *
 * ## WHY `Packer.toBuffer` IS NOT USED
 *
 * `generateExportDocx` returns a Node `Buffer` — it calls `Packer.toBuffer`.
 * In a browser bundle `Buffer` is the `buffer` shim that ships inside `docx`,
 * so the value is real and the bytes are correct, but its TYPE is Node's. The
 * one thing that matters here is not to pass it to `new Blob([...])` and hope:
 * the caller wraps it into a `Uint8Array` view first, which is both the correct
 * BlobPart and what makes the returned bytes typecheck without a Node type
 * leak into the web package.
 */
import type { ExportData } from "@mcpedia/types"
import { downloadBlob } from "./download"

/** The extension and MIME type the browser writes for this format. */
export const DOCX_MIME =
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document"

/**
 * Load the .docx builder on demand.
 *
 * ## WHY THIS IS NOT A TOP-LEVEL IMPORT
 *
 * The generator and its `docx` dependency are ~860 KB of JavaScript. A static
 * import puts all of it in the entry chunk, so EVERY visitor downloads it —
 * including the ones who only ever read documents. Measured, not assumed: with a
 * static import the built entry chunk went 854 KB -> 1,284 KB.
 *
 * A function-scoped `import()` makes it a separate chunk that is fetched on the
 * first export click and cached for the rest of the session. The build guard
 * still sees the specifier and still has to allow it (see
 * build/no-server-imports.ts — it matches on the source string either way).
 *
 * The return type is derived from the module rather than annotated, so it cannot
 * drift from the real signature.
 */
async function loadDocxBuilder() {
	const mod = await import("@mcpedia/core/export-docx")
	return mod.generateExportDocx
}

/**
 * Build the .docx and download it.
 *
 * `pageBreaks` is threaded through rather than hardcoded because the export
 * view exposes it as a checkbox ("Page Break per Challenge"), and a download
 * that ignored that control would silently produce a file that disagrees with
 * the preview on screen and with the printed PDF beside it.
 *
 * The generator returns a `Uint8Array` (see its doc comment in @mcpedia/core),
 * which is a valid `BlobPart` as-is. The copy into a fresh `ArrayBuffer` that
 * used to be here was working around the old `Buffer` return type — the copy
 * is gone because the type no longer needs it, and re-creating a view over
 * `bytes.buffer` would be a needless second pass over a few-hundred-KB file.
 */
export async function downloadExportDocx(
	exportData: ExportData,
	filename: string,
	options: { pageBreaks?: boolean } = {},
): Promise<void> {
	const buildDocx = await loadDocxBuilder()
	const bytes = await buildDocx(exportData, {
		pageBreaks: options.pageBreaks ?? true,
	})
	downloadBlob(new Blob([bytes], { type: DOCX_MIME }), filename)
}

/**
 * Build a single document's .docx and download it.
 *
 * A lone document is exported by wrapping it in the same `ExportData` envelope
 * `generateExportDocx` already consumes, rather than by adding a second
 * single-document code path to the generator. The generator branches on
 * `documents.length` for its table-of-contents chapter: with one document that
 * table is omitted and the single chapter is rendered as the body, which is
 * exactly the wanted shape for a per-document export.
 *
 * `summary` is synthesized rather than fetched: the document toolbar already
 * has the document, and the summary's only jobs here are the cover title, the
 * document count and the generated-at date. Fetching `documents.export` for one
 * slug would be a round trip for three display fields.
 */
export async function downloadDocumentDocx(
	doc: { slug: string; title: string; section: string; body: string },
	filename: string,
): Promise<void> {
	const exportData: ExportData = {
		summary: {
			scope: doc.slug,
			section: doc.section,
			sectionLabel: doc.section,
			title: doc.title,
			totalDocuments: 1,
			totalPoints: 0,
			categories: [],
			authors: [],
			generatedAt: new Date().toISOString(),
		},
		// `type`, `status`, `tags` and the timestamps are required by Document but
		// carry nothing the generator reads for a single-document export beyond
		// the title, body and section — which are supplied. Empty values keep the
		// shape honest rather than inventing metadata the document does not have.
		documents: [
			{
				id: doc.slug,
				slug: doc.slug,
				title: doc.title,
				section: doc.section,
				type: "",
				status: "published",
				author: "",
				tags: [],
				path: "",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				body: doc.body,
			},
		],
	}
	await downloadExportDocx(exportData, filename)
}
