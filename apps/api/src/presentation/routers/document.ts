import { os } from "@orpc/server"
import {
	classifyPath,
	createDocument,
	deleteDocument,
	extractFoldersForSection,
	getDocument,
	getExportDocuments,
	getRelated,
	listDocuments,
	listSections,
	updateDocument,
} from "@mcpedia/core"
import { requireWriteAuth } from "../middleware"
import {
	CreateDocumentInput,
	ExportInput,
	FolderInfoInput,
	ListDocumentsInput,
	RelatedInput,
	SlugInput,
	UpdateDocumentInput,
} from "../schemas"

/**
 * Documents: reads are public, the three CRUD procedures are write-gated.
 *
 * The NEW procedures (get, related, folderInfo, export) exist because six of
 * the web app's server components were calling @mcpedia/core in-process. Every
 * handler here delegates to that same core function — no logic was rewritten,
 * it just moved behind HTTP so the web app stops importing the database.
 */
export const documentRouter = os.router({
	// --- Reads (public) ---
	get: os.input(SlugInput).handler(({ input }) => getDocument(input.slug)),

	list: os
		.input(ListDocumentsInput)
		.handler(({ input }) => listDocuments(input ?? {})),

	sections: os.handler(() => listSections()),

	related: os
		.input(RelatedInput)
		.handler(({ input }) => getRelated(input.slug, input.limit)),

	/**
	 * Everything the slug page needs to decide what it is looking at.
	 *
	 * `classification` is `classifyPath` over the section's slugs; `folders` is
	 * the folder tree for breadcrumbs. Both are computed server-side from the
	 * same document list, so the page no longer imports core.
	 */
	folderInfo: os.input(FolderInfoInput).handler(async ({ input }) => {
		const docs = await listDocuments({ section: input.section })
		const docSlugs = docs.map((d) => d.slug)
		return {
			classification: classifyPath(docSlugs, input.path),
			folders: extractFoldersForSection(docSlugs, input.section),
			docCount: docSlugs.length,
		}
	}),

	/**
	 * Full documents + summary for the PDF export view.
	 *
	 * Returns data only. The DOCX/Markdown rendering stays in the web app
	 * (compileExportMarkdown / generateExportDocx are presentation concerns);
	 * this is the data path those renderers used to fetch in-process.
	 */
	export: os
		.input(ExportInput)
		.handler(({ input }) => getExportDocuments(input)),

	// --- Writes (gated by x-webhook-secret; see middleware.ts) ---
	create: os
		.use(requireWriteAuth)
		.input(CreateDocumentInput)
		.handler(({ input }) => createDocument(input)),

	update: os
		.use(requireWriteAuth)
		.input(UpdateDocumentInput)
		.handler(({ input }) => {
			const { slug, ...rest } = input
			return updateDocument(slug, rest)
		}),

	remove: os
		.use(requireWriteAuth)
		.input(SlugInput)
		.handler(({ input }) => deleteDocument(input.slug)),
})
