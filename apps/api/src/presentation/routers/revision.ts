import { revisionUseCases } from "@mcpedia/core"
import { os } from "@orpc/server"
import { auditActorOf, resolveSession } from "../context"
import { mapAppErrors, requireWriteAuthOrSession } from "../middleware"
import { IdInput, RevisionListInput } from "../schemas"

/**
 * Revision history. Listing and reading are public; restoring is write-gated.
 *
 * `mapAppErrors` is attached to all three, and the gate BEFORE it on restore, for
 * the reason documented in routers/document.ts: an unauthenticated caller must
 * fail on the credential (401) before its payload is validated (400), and the
 * mapper must sit closest to the handler to see the use case's own errors.
 */
export const revisionRouter = os.router({
	list: os
		.use(mapAppErrors)
		.input(RevisionListInput)
		.handler(({ input }) => revisionUseCases().list(input.slug, input.limit)),

	get: os
		.use(mapAppErrors)
		.input(IdInput)
		.handler(({ input }) => revisionUseCases().get(input.id)),

	// Restoring rewrites the live document, so it carries the same
	// x-webhook-secret gate as CRUD. A revision is not a safe read.
	restore: os
		.use(requireWriteAuthOrSession)
		.use(mapAppErrors)
		.input(IdInput)
		.handler(async ({ context, input }) => {
			// Restores are audited with the same actor resolution as document
			// writes: a rollback is a write, and "who rolled this back" is the
			// question the revision rows themselves cannot answer.
			// Same resolution as the document writes, for the same reason: the
			// restore must be attributable whether it arrived over the secret or a
			// session. Routers resolve the actor the same way rather than each
			// re-deriving which credential authenticated the request.
			const actor = auditActorOf(await resolveSession(context))
			return revisionUseCases(actor).restore(input.id)
		}),
})
