import { os } from "@orpc/server"
import { getRevision, listRevisions, restoreRevision } from "@mcpedia/core"
import { requireWriteAuth } from "../middleware"
import { IdInput, RevisionListInput } from "../schemas"

/**
 * Revision history. Listing and reading are public; restoring is write-gated.
 */
export const revisionRouter = os.router({
	list: os
		.input(RevisionListInput)
		.handler(({ input }) => listRevisions(input.slug, input.limit)),

	get: os.input(IdInput).handler(({ input }) => getRevision(input.id)),

	// Restoring rewrites the live document, so it carries the same
	// x-webhook-secret gate as CRUD. A revision is not a safe read.
	restore: os
		.use(requireWriteAuth)
		.input(IdInput)
		.handler(({ input }) => restoreRevision(input.id)),
})
