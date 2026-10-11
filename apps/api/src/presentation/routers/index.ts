import { os } from "@orpc/server"
import { authRouter } from "./auth"
import { documentRouter } from "./document"
import { healthRouter } from "./health"
import { queueRouter } from "./queue"
import { revisionRouter } from "./revision"
import { searchRouter } from "./search"

/**
 * The RPC surface: 21 procedures.
 *
 * 15 carried over from the tRPC router (11 reads + 4 write-gated), plus 6 that
 * the web app previously ran in-process by importing @mcpedia/core directly:
 *   documents.get, documents.related, revisions.list,
 *   documents.export, documents.folderInfo, auth.me
 *
 * Composition is server-first: every procedure carries its own inline handler.
 * There is deliberately no `implement(contract, ...)` step — the contract would
 * be a second place to keep in sync with no gain, and v1's `implement()` second
 * argument is a BuilderConfig that is easy to misuse.
 */
export const appRouter = os.router({
	auth: authRouter,
	health: healthRouter,
	search: searchRouter,
	documents: documentRouter,
	revisions: revisionRouter,
	queue: queueRouter,
})

export type AppRouter = typeof appRouter
