import { WEBHOOK_SECRET } from "@mcpedia/config"

/**
 * Authorization for web CRUD requests.
 *
 * This module replaced three byte-identical copies of `isAuthorized` that each
 * ended in `cookie.startsWith("admin.")`. That check compared a PREFIX and
 * never re-derivable the HMAC, so any cookie value beginning with the literal
 * string "admin." authenticated as the admin — the signature bytes were
 * decorative. The follow-up fixed the signature but kept the HMAC scheme.
 *
 * The HMAC cookie is now retired entirely. `mcpedia_admin` was never a session:
 * it never expired server-side, it was not revocable, and every login minted
 * the SAME cookie value, so there was no identity behind it and no way to end a
 * session short of rotating ADMIN_PASSWORD. Web auth is a better-auth session
 * now (see auth-server.ts) — a per-session random token, expiring, revocable,
 * carrying the user's role.
 *
 * ## SCOPE — read this before "unifying" the two paths
 *
 * `x-webhook-secret` below is the WEB-side equivalent of the MCP write gate and
 * is retained on purpose. The MCP write gate (apps/mcp/src/index.ts) MUST keep
 * using x-webhook-secret: stdio MCP has no user session, so there is nothing
 * for a cookie to carry. Sweeping that into the session path would regress the
 * bypass fixes in 177e015 / 804e9e3.
 *
 * The cookie path is gone. `COOKIE_NAME` remains ONLY so a stale `mcpedia_admin`
 * cookie can be explicitly deleted rather than lingering in the browser
 * forever.
 */

import { createHash, timingSafeEqual } from "node:crypto"
import { getAuth } from "./auth-server"
import { headers } from "next/headers"

/** Retired. Exported only so logout can clear a stale cookie. */
export const COOKIE_NAME = "mcpedia_admin"

/**
 * Constant-time string comparison.
 *
 * Both sides are hashed to a fixed 32 bytes first, so the comparison never
 * takes a different path based on input length. Comparing the raw strings
 * requires a length pre-check (timingSafeEqual throws on a mismatch), and that
 * pre-check is itself a length oracle: a wrong-length guess returns measurably
 * faster than an equal-length wrong guess, which leaks the secret's length one
 * bit per character.
 *
 * Hashing also removes the try/catch: `createHash` on a string cannot throw for
 * well-formed JS strings, and the digests are always equal length.
 */
export function safeTimingEqual(a: string, b: string): boolean {
	const digest = (s: string) => createHash("sha256").update(s).digest()
	return timingSafeEqual(digest(a), digest(b))
}

/** A valid `x-webhook-secret` header value, in constant time. Fails closed. */
export function hasValidSecretHeader(headers_: Headers): boolean {
	if (!WEBHOOK_SECRET) return false
	const provided = headers_.get("x-webhook-secret") ?? ""
	if (!provided) return false
	return safeTimingEqual(provided, WEBHOOK_SECRET)
}

/**
 * A valid better-auth session carrying the `admin` role.
 *
 * Returns false — never true — when the secret is unconfigured or the session
 * cannot be read. An auth check that cannot verify anything must deny.
 */
export async function hasValidSession(): Promise<boolean> {
	try {
		const session = await getAuth().api.getSession({
			headers: await headers(),
		})
		const user = session?.user as { role?: string } | undefined
		return user?.role === "admin"
	} catch {
		// Unconfigured secret (requireEnv throws) or an unreachable database.
		// Both mean "cannot authorize", which must read as "denied".
		return false
	}
}

/**
 * Authorize a web CRUD request: a valid `x-webhook-secret` header (the API/MCP
 * style, used by the inline editor which receives the secret) OR an active
 * better-auth session for an admin user (the human login flow).
 *
 * Fails closed: with `WEBHOOK_SECRET` unset the header path is unavailable,
 * and the session path independently refuses.
 */
export async function isAuthorized(headers_: Headers): Promise<boolean> {
	if (hasValidSecretHeader(headers_)) return true
	return await hasValidSession()
}
