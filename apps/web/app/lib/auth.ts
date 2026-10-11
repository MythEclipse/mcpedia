import { createHmac, timingSafeEqual } from "node:crypto"
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

/** HMAC-sign a cookie value as `<value>.<sig>`. */
export function signCookie(value: string): string {
	const secret = ADMIN_PASSWORD || "fallback"
	const sig = createHmac("sha256", secret).update(value).digest("hex")
	return `${value}.${sig}`
}

/**
 * Constant-time string comparison.
 *
 * `timingSafeEqual` throws when buffer lengths differ, which would itself leak
 * length information through the exception — so the length check happens first
 * and the call is wrapped.
 */
export function safeTimingEqual(a: string, b: string): boolean {
	try {
		const bufA = Buffer.from(a)
		const bufB = Buffer.from(b)
		if (bufA.length !== bufB.length) return false
		return timingSafeEqual(bufA, bufB)
	} catch {
		return false
	}
}

/**
 * Verify an `mcpedia_admin` cookie by re-deriving its signature from the
 * configured `ADMIN_PASSWORD` and comparing in constant time.
 */
export function verifyCookie(cookieValue: string | undefined): boolean {
	if (!cookieValue) return false
	const [value, sig] = cookieValue.split(".")
	if (!value || !sig) return false
	const expected = signCookie(value)
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
