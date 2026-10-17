/**
 * Turn a title into a safe download filename.
 *
 * ## WHY THIS IS ITS OWN MODULE
 *
 * It was a module-local function in PdfExportView, where its only caller was the
 * "Download .md" button. The document toolbar's .docx export needs the same
 * rule, and a component importing another component to reach a three-line
 * string function is the kind of dependency that eventually gets copy-pasted
 * instead of imported — at which point the two sluggers drift and one of them
 * starts emitting filenames with a slash in them.
 *
 * PdfExportView re-exports this name, so its existing test (which imports
 * `exportFilename` from the component) still exercises the real implementation
 * rather than a copy.
 *
 * ## WHY THE FALLBACK MATTERS
 *
 * A title made entirely of characters the slugger strips — "!!!" — reduces to
 * the empty string, and the empty string produces the filename ".md". Browsers
 * treat a leading dot as a hidden file and some refuse to save it at all, so the
 * user sees a download that appears to do nothing. The fallback is therefore not
 * cosmetic.
 */
export function exportFilename(title: string, fallback = "export"): string {
	const safe = title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
	return safe || fallback
}
