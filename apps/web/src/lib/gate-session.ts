/**
 * The role rule for a better-auth session, as a leaf module.
 *
 * Split out of auth-client.ts so it can be tested without importing
 * createAuthClient (which touches nanostores and `window`) — see the note in
 * src/lib/sections.ts for why the root vitest config constrains module layout.
 */

/** The subset of the better-auth session this app reads. */
export interface Session {
	user: { role?: string; name?: string; email?: string }
	session?: { id: string; expiresAt?: string | Date }
}

/** The role that grants document mutations. Matches the DB column's values. */
export type Role = "admin" | "user"

/**
 * Whether the session carries the admin role.
 *
 * The role comes from the session's own user row, never from anything the
 * browser sent — that is what retiring the HMAC cookie bought, since the old
 * cookie was a bare boolean with no identity behind it. An absent role reads as
 * NOT admin: better-auth's `role` column defaults to "user", so a missing value
 * means it was never populated, and an auth check that cannot see a role must
 * refuse.
 */
export function isAdminSession(session: Session | null): boolean {
	return session?.user?.role === "admin"
}
