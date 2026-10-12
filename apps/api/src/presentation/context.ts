import type { db as Db } from "@mcpedia/db"
import { forbidden, type AuditActor, unauthorized } from "@mcpedia/core"
import { match } from "ts-pattern"
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
	/** Real Postgres connection; read procedures reach it via @mcpedia/db. */
	db: typeof Db
	/** The raw incoming request, for reading headers and cookies. */
	request: Request
	/** Raw `x-webhook-secret` header from the incoming request, if present. */
	webhookSecret?: string
	/** The configured expected secret, so tests can inject a fake. */
	expectedSecret: string
	/**
	 * The caller's better-auth session, resolved on demand.
	 *
	 * A FUNCTION, not a value, and that is the load-bearing part: verifying a
	 * session reads the `session` table, and most procedures are public reads
	 * that never look at who is calling. Resolving eagerly would add a database
	 * round trip to every search keystroke and every page view. The returned
	 * promise is memoised per request, so the write gate and auth.me can both ask
	 * without paying twice.
	 */
	loadSession: () => Promise<Session | null>
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
	/** Which credential established this session. Diagnostic, never load-bearing. */
	via: SessionVia
	/**
	 * The better-auth user id, when there is one.
	 *
	 * Absent on the secret path — a shared secret identifies a credential, not a
	 * person, and inventing an id for it would put a fictitious actor in the audit
	 * trail. The audit row for such a write records `via: "webhook-secret"` with no
	 * user id, which is exactly as much as is knowable.
	 */
	userId?: string
}

/**
 * How a caller proved who they are.
 *
 * Two values because there are genuinely two credentials in this deployment:
 *
 *  - "webhook-secret" — the shared secret, used by the MCP server over stdio
 *    where there is no browser and therefore no session.
 *  - "session" — a better-auth session cookie, which only a browser can hold.
 *
 * A caller may satisfy EITHER. Nothing branches on `via`, because which credential
 * was used is an audit detail; what matters is the resulting `role`, and that is
 * resolved once, in resolveSession.
 */
export type SessionVia = "webhook-secret" | "session"

/**
 * The roles this deployment has.
 *
 * `"user"` exists because better-auth's own user model carries it: the bootstrap
 * rule in apps/api/src/auth.ts makes the FIRST account an admin and every later
 * one a plain user. A second role was always coming, so it is named here rather
 * than left to be invented at the first call site that needs it — and because
 * auth.me is part of the public type surface, widening the union later is not a
 * breaking change for consumers.
 */
export type AppRole = "admin" | "user"

/**
 * Does this request carry the webhook secret?
 *
 * The same constant-time check the write gate uses. Unlike the gate this returns
 * a value rather than throwing, because auth.me's whole job is to report the
 * answer — including when it is "no".
 *
 * Only the SECRET path is decided here. The session path needs the database, so it
 * is resolved by the caller through `loadSession` and combined by
 * resolveSession below. Splitting it this way is what keeps this function a pure
 * check with no I/O.
 */
export function resolveSecretSession(context: unknown): Session | null {
	const { webhookSecret, expectedSecret } = asApiContext(context)
	if (!webhookSecret || !expectedSecret) return null
	if (!safeSecretEqual(webhookSecret, expectedSecret)) return null
	return { role: "admin", via: "webhook-secret" }
}

/**
 * The caller's session, whichever credential establishes it.
 *
 * The secret is checked FIRST because it is free: a constant-time comparison of
 * two strings, no database. Only when that fails does the session cookie get
 * resolved, which is the path a browser takes on every request and the path the
 * MCP server never takes.
 *
 * A non-admin session resolves to a real Session with role "user", not to null.
 * That distinction is the difference between "you are signed in and may read but
 * not write" and "you are not signed in", and auth.me reports both.
 */
export async function resolveSession(
	context: unknown,
): Promise<Session | null> {
	const ctx = asApiContext(context)
	const bySecret = resolveSecretSession(context)
	if (bySecret) return bySecret
	return await ctx.loadSession()
}

/** The role that may mutate documents. Mirrors the DB column's values. */
export const WRITE_ROLE: AppRole = "admin"

/** Whether a resolved session may mutate documents. */
export function canWrite(session: Session | null): boolean {
	return session?.role === WRITE_ROLE
}

/**
 * Single-tenant authorization: a role gate, expressed once.
 *
 * ## WHY THIS EXISTS IN THIS SHAPE
 *
 * The kana spec has two role systems — an org-scoped `owner | admin | member`
 * and a platform `admin | user`. This deployment is SINGLE-TENANT (confirmed by
 * the operator), so the spec's own single-tenant clause applies: "Keep
 * `requireRole` but on the single `user.role` axis only (`admin | user`)".
 * `organization`, `member` and `role` aggregates therefore do not exist here,
 * and there is no `organizationId` on any table to scope a query by.
 *
 * What remains is the authorization PRIMITIVE: a named check that says which
 * roles pass, so the answer to "who may write?" lives in one place instead of
 * being re-derived as `session?.role === "admin"` at each call site. The first
 * three call sites of that literal are what produced this function.
 *
 * It returns the session on success and throws a typed `unauthorized`/
 * `forbidden` on failure, so the caller does not need its own error shape and
 * the status code comes from the single error-mapping table rather than from a
 * second hard-coded 401/403 decision per site.
 *
 * `ts-pattern` does the matching. On a union of string literals it is the
 * exhaustive-by-construction form: adding a role to `AppRole` makes `.otherwise`
 * unreachable rather than silently falling through, which is exactly the
 * failure mode that matters for an authorization check — a new role that no
 * branch handles must be REFUSED, not admitted by an unhandled default.
 *
 * Single-tenant also means what it says: there is no `requirePermission`
 * resource/action matrix. Every authenticated caller can read; only WRITE_ROLE
 * can mutate. A per-resource matrix would be machinery for a permission model
 * this app does not have.
 */
export function requireRole(
	session: Session | null,
	...allowed: readonly AppRole[]
): Session {
	if (!session) throw unauthorized("authentication required")
	const permitted = allowed.length > 0 ? allowed : [WRITE_ROLE]

	// An unknown/absent role is refused, never admitted: `canWrite`-style
	// defaulting is correct for reporting ("you are a user") and WRONG for
	// authorizing (a role nobody recognised must not pass the gate).
	//
	// `.exhaustive()` is the load-bearing part, not the matching. It makes the
	// compiler reject this function the moment a role is added to `AppRole`,
	// forcing an explicit decision about whether the new role may write. A
	// plain `permitted.includes(session.role)` would keep compiling and would
	// silently refuse — or, if someone later "simplified" it to a truthy check,
	// silently ADMIT an unvetted role.
	//
	// `admin` is allowed unless a caller explicitly narrows the list to exclude
	// it; that is the natural reading of `requireRole(session, "user")`.
	const ok = match(session.role)
		.with("admin", () => permitted.includes("admin"))
		.with("user", () => permitted.includes("user"))
		.exhaustive()

	if (!ok) throw forbidden("insufficient role")
	return session
}

/**
 * Translate a resolved session into the domain's audit actor.
 *
 * ## WHY THIS LIVES HERE AND NOT IN THE ROUTER
 *
 * The router has a `Session`; the core has an `AuditActor`. Somebody has to hold
 * the mapping between them, and the presentation layer is the only layer that
 * knows both. Putting it beside `resolveSession` keeps the whole "who is this
 * request" question in one file, so a second credential added later has exactly
 * one place to extend.
 *
 * Returns undefined for a null session rather than a synthetic actor: an
 * unauthenticated request cannot reach a write handler (the gate throws first), so
 * a null here means "no actor", and the use case's own default of SYSTEM_ACTOR is
 * the honest answer for a write that genuinely had no principal.
 */
export function auditActorOf(session: Session | null): AuditActor | undefined {
	if (!session) return undefined
	return {
		via: session.via,
		role: session.role,
		...(session.userId ? { userId: session.userId } : {}),
	}
}
