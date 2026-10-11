import { initTRPC } from "@trpc/server"
import { db } from "@mcpedia/db"

export interface Context {
	db: typeof db
	// Raw `x-webhook-secret` header from the incoming request, if present.
	// State-changing tRPC mutations (restoreRevision, CRUD) require it to match
	// the configured secret; read-only procedures ignore it.
	webhookSecret?: string
	// The configured expected secret (from deps). Used by requireWriteAuth
	// to validate the header — request-scoped so tests can inject a fake.
	expectedSecret: string
}

export const t = initTRPC.context<Context>().create()

export const router = t.router
export const publicProcedure = t.procedure
