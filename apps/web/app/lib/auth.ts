import { createHash, createHmac, timingSafeEqual } from "node:crypto"
import { ADMIN_PASSWORD, WEBHOOK_SECRET } from "@mcpedia/config"

// Single source of truth for web authentication.
//
// This module replaced three byte-identical copies of `isAuthorized` that each
// ended in `cookie.startsWith("admin.")`. That check compared a PREFIX and never
// re-derived the HMAC, so any cookie value beginning with the literal string
// "admin." authenticated as the admin — the signature bytes were decorative.
// `verifyCookie` below was already correct but lived, unexported, inside the
// login route where no other file could reach it.

export const COOKIE_NAME = "mcpedia_admin"
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

/** The only cookie value that authenticates. Bound at login (see api/auth/login). */
export const COOKIE_VALUE = "admin"

/**
 * HMAC-sign a cookie value as `<value>.<sig>`.
 *
 * Throws when ADMIN_PASSWORD is unset. It previously fell back to the literal
 * string "fallback", which is a hardcoded key committed to the repository:
 * anyone reading the source could mint a valid admin cookie for an
 * unconfigured deployment and get full web CRUD. A missing password must
 * disable authentication, never authenticate everyone.
 */
export function signCookie(value: string): string {
	if (!ADMIN_PASSWORD) {
		throw new Error("ADMIN_PASSWORD is not configured; cannot sign a cookie")
	}
	const sig = createHmac("sha256", ADMIN_PASSWORD).update(value).digest("hex")
	return `${value}.${sig}`
}

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
 * Hashing first also removes the try/catch: `createHash` on a string cannot
 * throw for well-formed JS strings, and the digests are always equal length.
 */
export function safeTimingEqual(a: string, b: string): boolean {
	const digest = (s: string) => createHash("sha256").update(s).digest()
	return timingSafeEqual(digest(a), digest(b))
}

/**
 * Verify an `mcpedia_admin` cookie by re-deriving its signature from the
 * configured `ADMIN_PASSWORD` and comparing in constant time.
 *
 * The cookie value must be exactly COOKIE_VALUE. Re-deriving the HMAC over
 * whatever value the cookie carries would only prove the caller knows
 * ADMIN_PASSWORD, not that they are the admin — any correctly-signed value
 * (`signCookie("root")`, say) would otherwise authenticate.
 */
export function verifyCookie(cookieValue: string | undefined): boolean {
	if (!cookieValue) return false
	const [value, sig] = cookieValue.split(".")
	if (value !== COOKIE_VALUE) return false
	if (!value || !sig) return false
	// signCookie throws when ADMIN_PASSWORD is unset. That must read as
	// "not authenticated", never as a 500 that leaks configuration state.
	let expected: string
	try {
		expected = signCookie(value)
	} catch {
		return false
	}
	return safeTimingEqual(cookieValue, expected)
}

/**
 * Authorize a web CRUD request: a valid `x-webhook-secret` header (the API/MCP
 * style, used by the inline editor which receives the secret) OR a validly
 * signed `mcpedia_admin` cookie (the human login flow).
 *
 * Fails closed: with `WEBHOOK_SECRET` unset, the header path is unavailable and
 * cookie auth is denied outright rather than silently allowing access.
 */
export function isAuthorized(
	headers: Headers,
	cookieValue: string | undefined,
): boolean {
	if (!WEBHOOK_SECRET) return false

	const headerSecret = headers.get("x-webhook-secret") ?? ""
	if (headerSecret) {
		if (safeTimingEqual(headerSecret, WEBHOOK_SECRET)) return true
	}

	return verifyCookie(cookieValue)
}
