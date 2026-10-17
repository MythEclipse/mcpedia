/**
 * Trigger a browser download of a Blob under `filename`.
 *
 * ## WHY THE OBJECT URL IS REVOKED
 *
 * `URL.createObjectURL` returns a URL that pins the Blob in memory until it is
 * revoked or the document is unloaded. A long session that exports a dozen PDFs
 * and .docx files would hold every one of them alive. The revoke happens after
 * the click has been dispatched, not before: revoking first would cancel the
 * download in some browsers because the navigation has not started yet.
 *
 * ## WHY THE ANCHOR IS ATTACHED TO THE DOCUMENT
 *
 * A detached anchor's `.click()` works in Chrome and does not in Firefox. The
 * append/click/remove dance is the portable form, and it is why this is a named
 * helper instead of one line at each call site.
 *
 * Extracted from PdfExportView, which had this as a module-local function. Two
 * callers need it now (the export view and the document toolbar's .docx button),
 * so it lives in lib/ where both can reach it without one component importing
 * another.
 */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement("a")
	anchor.href = url
	anchor.download = filename
	document.body.appendChild(anchor)
	anchor.click()
	document.body.removeChild(anchor)
	URL.revokeObjectURL(url)
}
