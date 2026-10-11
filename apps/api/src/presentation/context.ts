import type { db as Db } from "@mcpedia/db"
import { safeSecretEqual } from "../secret"

/**
 * Request-scoped context handed to every oRPC procedure.
 *
 * This replaces the tRPC `Context` interface (apps/api/src/trpc.ts, now
 * deleted) with the same fields, so the middleware and handlers keep reading
 * exactly what they read before. `request` is new: auth.me needs the incoming
 * headers, and tRPC never exposed them to a procedure.
 */
export interface ApiContext {
	/** Real Postgres connection; read procedures reach it via @mcpedia/core. */
	db: typeof Db
	/** The raw incoming request, for reading headers and cookies. */
	request: Request
	/** Raw `x-webhook-secret` header from the incoming request, if present. */
	webhookSecret?: string
	/** The configured expected secret, so tests can inject a fake. */
	expectedSecret: string
}

/**
 * Narrow a procedure's context to `ApiContext`.
 *
 * `os` is declared with an empty context (`Record<never, never>`) because oRPC
 * v1 has no way to declare a router's context type at the builder — the context
 * is supplied per request by the handler adapter, so the builder cannot know it.
 * Every procedure therefore receives `Record<never, never>` and casts. That cast
 * is safe, and provably so: the ONLY place an ApiContext is constructed is
 * `createApp`'s `rpcHandler.handle({ context })` call, which is the single
 * entry point for all procedure invocations.
 *
 * Funnelled through one function so the "why is this cast safe" reasoning lives
 * in one place instead of being re-argued at every `as` in every handler.
 */
export function asApiContext(context: unknown): ApiContext {
	return context as ApiContext
}

/** Who is calling, and by what route. `null` when unauthenticated. */
export interface Session {
	role: AppRole
	via: "webhook-secret"
}

/**
 * The single role this deployment has.
 *
 * Named as a union rather than the literal "admin" because auth.me is part of a
 * public type surface (exported from the barrel) — a second role later is a
 * widening here, not a breaking change for consumers.
 */
export type AppRole = "admin"

/**
 * Does this request carry the webhook secret?
 *
 * The same constant-time check the write gate uses. Unlike the gate this
 * returns a boolean rather than throwing, because auth.me's whole job is to
 * report the answer — including when it is "no".
 */
export function resolveSession(context: unknown): Session | null {
	const { webhookSecret, expectedSecret } = asApiContext(context)
	if (!webhookSecret || !expectedSecret) return null
	if (!safeSecretEqual(webhookSecret, expectedSecret)) return null
	return { role: "admin", via: "webhook-secret" }
}
