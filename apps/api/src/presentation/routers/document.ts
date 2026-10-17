import {
	classifyPath,
	documentUseCases,
	extractFoldersForSection,
	getDocument,
	getExportDocuments,
	getRelated,
	listDocuments,
	sectionUseCases,
} from "@mcpedia/core"
import { os } from "@orpc/server"
import { auditActorOf, resolveSession } from "../context"
import { mapAppErrors, requireWriteAuthOrSession } from "../middleware"
import {
	CreateDocumentInput,
	ExportInput,
	FolderInfoInput,
	ListDocumentsInput,
	RelatedInput,
	RemoveSectionInput,
	SlugInput,
	UpdateDocumentInput,
	UpsertSectionInput,
} from "../schemas"

/**
 * Documents: reads are public, the three CRUD procedures are write-gated.
 *
 * The procedures (get, related, folderInfo, export) exist because six of the web
 * app's server components were calling @mcpedia/core in-process. Every handler
 * here delegates to that same core function — no logic was rewritten, it just
 * moved behind HTTP so the web app stops importing the database.
 *
 * ## MIDDLEWARE ORDER IS LOAD-BEARING
 *
 * `os.middleware(...).input(schema).handler(fn)` runs the middlewares in the order
 * they were attached, innermost-first relative to the handler. So the gate is
 * attached BEFORE the schema and the error mapper wraps everything:
 *
 *   requireWriteAuthOrSession -> zod validation -> mapAppErrors -> handler
 *
 * That order is what makes an unauthenticated request fail on the CREDENTIAL
 * rather than on its payload: a 401 must not be preceded by a 400 for a malformed
 * body, or an unauthenticated caller learns the shape of a schema it has no right
 * to probe. `mapAppErrors` sits closest to the handler so it sees the use case's
 * own typed errors, while a validation failure stays oRPC's native 400.
 */
/**
 * The audit actor for a write request.
 *
 * ## WHY THE SECRET IS CHECKED FIRST HERE AND NOT JUST THE SESSION
 *
 * The write gate accepts EITHER credential, and the two leave different traces.
 * A caller presenting `x-webhook-secret` is the MCP server over stdio: there is no
 * browser and therefore no session cookie, so `loadSession()` returns null and
 * `auditActorOf(null)` yields undefined — the write would be attributed to
 * nothing at all. `resolveSecretSession` already models this credential as an
 * admin session, so consulting it first is not a second check but the same check
 * the gate performs, read from the request rather than recomputed.
 *
 * This is the ordering the gate itself uses, for the same reason: the secret is a
 * constant-time string comparison with no I/O, and the session costs a database
 * lookup. Doing the cheap one first also means an MCP write — the common case on
 * that path — never touches the session table.
 *
 * The session is memoised on the request context (see `loadSession`), so the
 * fallback branch is free when the gate already resolved it. That is not
 * incidental: it is why adding the audit actor did not add a database round trip
 * to a browser write, and session-gate.test.ts asserts the lookup count.
 */
async function actorOf(context: unknown) {
	return auditActorOf(await resolveSession(context))
}

export const documentRouter = os.router({
	// --- Reads (public) ---

	get: os
		.use(mapAppErrors)
		.input(SlugInput)
		.handler(({ input }) => getDocument(input.slug)),

	list: os
		.use(mapAppErrors)
		.input(ListDocumentsInput)
		.handler(({ input }) => listDocuments(input ?? {})),

	sections: os.use(mapAppErrors).handler(() => documentUseCases().sections()),

	/**
	 * The full section registry, hidden rows included.
	 *
	 * Distinct from `documents.sections` above, which is the NAV-FACING read:
	 * that one drops hidden sections and attaches document counts. This is the
	 * admin view — an operator editing the registry must be able to see the
	 * section they hid, or they cannot unhide it.
	 */
	sectionsRegistry: os
		.use(mapAppErrors)
		.handler(() => sectionUseCases().list()),

	/**
	 * Register a section or update one.
	 *
	 * Write-gated like the document CRUD. Section metadata used to be a constant
	 * in @mcpedia/config, so changing a section's name required a deploy; this is
	 * the endpoint that makes it content.
	 */
	upsertSection: os
		.use(requireWriteAuthOrSession)
		.use(mapAppErrors)
		.input(UpsertSectionInput)
		.handler(async ({ input }) => sectionUseCases().upsert(input)),

	/**
	 * Unregister a section — its metadata row only, never its documents.
	 *
	 * `documents.section` is a plain string, so the documents remain readable at
	 * their URLs with a derived label. Deleting content is a separate,
	 * per-document operation (documents.remove).
	 */
	removeSection: os
		.use(requireWriteAuthOrSession)
		.use(mapAppErrors)
		.input(RemoveSectionInput)
		.handler(async ({ input }) => sectionUseCases().remove(input.id)),

	related: os
		.use(mapAppErrors)
		.input(RelatedInput)
		.handler(({ input }) => getRelated(input.slug, input.limit)),

	/**
	 * Everything the slug page needs to decide what it is looking at.
	 *
	 * `classification` is `classifyPath` over the section's slugs; `folders` is
	 * the folder tree for breadcrumbs. Both are computed server-side from the
	 * same document list, so the page no longer imports core.
	 */
	folderInfo: os
		.use(mapAppErrors)
		.input(FolderInfoInput)
		.handler(async ({ input }) => {
			const docs = await documentUseCases().list({ section: input.section })
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
		.use(mapAppErrors)
		.input(ExportInput)
		.handler(({ input }) => getExportDocuments(input)),

	// --- Writes (gated by x-webhook-secret; see middleware.ts) ---
	create: os
		.use(requireWriteAuthOrSession)
		.use(mapAppErrors)
		.input(CreateDocumentInput)
		.handler(async ({ context, input }) => {
			const actor = await actorOf(context)
			return documentUseCases(actor).create(input)
		}),

	update: os
		.use(requireWriteAuthOrSession)
		.use(mapAppErrors)
		.input(UpdateDocumentInput)
		.handler(async ({ context, input }) => {
			const { slug, ...rest } = input
			const actor = await actorOf(context)
			return documentUseCases(actor).update(slug, rest)
		}),

	remove: os
		.use(requireWriteAuthOrSession)
		.use(mapAppErrors)
		.input(SlugInput)
		.handler(async ({ context, input }) => {
			const actor = await actorOf(context)
			return documentUseCases(actor).remove(input.slug)
		}),
})
