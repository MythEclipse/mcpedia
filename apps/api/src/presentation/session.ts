import { getSessionForRequest, isAdminRequest } from "../auth"
import type { AppRole, Session } from "./context"

/**
 * Read the caller's role out of a better-auth session.
 *
 * ## WHY THE ROLE IS READ, NOT ASSUMED
 *
 * The value compared here comes from the session's own `user` row in the database,
 * never from a header, a cookie the browser could have written, or anything else
 * the caller supplied. That is the entire reason better-auth replaced the retired
 * HMAC cookie, whose value was the literal string "admin" for every login.
 *
 * An absent or unrecognised role reads as "user", never as admin: the column
 * defaults to "user", so a missing value means it was never populated, and a
 * check that cannot see a role must refuse.
 */
function roleOf(
	session: Awaited<ReturnType<typeof getSessionForRequest>>,
): AppRole {
	const user = session?.user as { role?: string } | undefined
	return user?.role === "admin" ? "admin" : "user"
}

/**
 * Build the request-scoped `loadSession` for one incoming request.
 *
 * ## WHY IT IS A CLOSURE OVER ONE REQUEST
 *
 * The memoisation lives here rather than on the context object so it cannot
 * outlive the request it belongs to. A module-level cache would keep a user's
 * role alive across requests — and would then serve a stale "admin" after the
 * role was revoked, which is the worst possible failure for this cache. One
 * closure, one request, discarded after.
 *
 * `null` is memoised too. A caller without a cookie asks on every procedure, and
 * without this each miss would hit the database.
 */
export function sessionLoader(request: Request): () => Promise<Session | null> {
	let pending: Promise<Session | null> | null = null

	return () => {
		pending ??= (async () => {
			const session = await getSessionForRequest(request)
			if (!session) return null
			const user = session.user as { id?: string; role?: string } | undefined
			return {
				role: roleOf(session),
				via: "session" as const,
				// Carried through so a write can name WHO performed it. Without this
				// the audit row would record a role and a credential but no actor,
				// which is the one field an operator reading the trail most needs.
				// Omitted rather than defaulted when absent — a placeholder id would
				// be a fabricated identity in an append-only log.
				...(user?.id ? { userId: user.id } : {}),
			}
		})()
		return pending
	}
}

/**
 * Whether this request carries an admin session, without building a Session.
 *
 * Kept as a named predicate because "is this an admin request" is a question
 * other call sites ask — the /dashboard route and the hooks endpoint — and it
 * should not be re-derived from the session's internals each time.
 */
export function isAdminSessionRequest(request: Request): Promise<boolean> {
	return isAdminRequest(request)
}
