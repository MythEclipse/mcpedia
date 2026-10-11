import type { MeResponse } from "../lib/api-client"

/**
 * The auth gate decision, in one place.
 *
 * Both call sites — the route's beforeLoad and its test — read this same
 * function, so the rule cannot drift between them.
 *
 * `authenticated` alone is deliberately NOT enough. auth.me reports
 * `authenticated` with a role, and a non-admin user is a legitimate signed-in
 * state: they can read everything and write nothing. Gating on the flag rather
 * than the role would render an editor whose only possible outcome is a 401.
 */
export function isAdmin(me: MeResponse | null): boolean {
	return me?.authenticated === true && me.role === "admin"
}

/**
 * Should the create route redirect to /login?
 *
 * A missing/unreachable `me` (null) counts as NOT allowed. "Cannot tell" must
 * read as "no": the alternative is to render the editor on a failed check and
 * let the user discover at submit time that the write was refused.
 *
 * This is UX, not authorization. The authoritative check is requireWriteAuth in
 * the procedure, which no client-side redirect can influence.
 */
export function shouldRedirectToLogin(me: MeResponse | null): boolean {
	return !isAdmin(me)
}
