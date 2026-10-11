import { describe, expect, test } from "vitest"
import { createHmac } from "node:crypto"
import { WEBHOOK_SECRET } from "@mcpedia/config"
import { hasValidSecretHeader, safeTimingEqual, COOKIE_NAME } from "./auth"

/**
 * The web auth path had no tests at all: three copies of `isAuthorized` shipped
 * a prefix-only cookie check (`startsWith("admin.")`) for months without
 * anything failing. The follow-up added signature verification and these cases;
 * the HMAC cookie has since been replaced by a better-auth session, and the
 * cases that matter now are the ones about what is still accepted.
 *
 * The session path itself is not unit-tested here: it needs a live Postgres and
 * a configured BETTER_AUTH_SECRET, and `next build` exercises the wiring. What
 * IS tested is the header path that remains load-bearing for the web editor, and
 * the constant-time comparison it depends on.
 */

/** Sign an arbitrary value the way the retired signCookie did. */
const forgeWith = (key: string, value: string) =>
	`${value}.${createHmac("sha256", key).update(value).digest("hex")}`

describe("safeTimingEqual", () => {
	test("compares equal and unequal values", () => {
		expect(safeTimingEqual("abc", "abc")).toBe(true)
		expect(safeTimingEqual("abc", "abd")).toBe(false)
	})

	test("does not leak length through a length pre-check", () => {
		// timingSafeEqual THROWS on a length mismatch, so comparing raw strings
		// forces an `a.length === b.length` guard first — and that guard returns
		// faster for a wrong-length guess, which is a length oracle. Hashing both
		// sides to a fixed 32 bytes first removes the branch entirely, so
		// differing lengths must simply be false, never a throw.
		expect(() => safeTimingEqual("", "much longer secret")).not.toThrow()
		expect(safeTimingEqual("", "much longer secret")).toBe(false)
		expect(safeTimingEqual("a", "")).toBe(false)
	})
})

describe("hasValidSecretHeader", () => {
	test("refuses everything when WEBHOOK_SECRET is unset", () => {
		// Fails closed. An unconfigured secret must disable the header path
		// entirely, never authenticate everyone.
		if (WEBHOOK_SECRET) {
			expect(
				hasValidSecretHeader(new Headers({ "x-webhook-secret": "x" })),
			).toBe(false)
			return
		}
		expect(
			hasValidSecretHeader(new Headers({ "x-webhook-secret": "anything" })),
		).toBe(false)
		expect(
			hasValidSecretHeader(
				new Headers({ "x-webhook-secret": forgeWith("", "x") }),
			),
		).toBe(false)
	})

	test("accepts only the exact configured secret", () => {
		if (!WEBHOOK_SECRET) return
		const good = new Headers({ "x-webhook-secret": WEBHOOK_SECRET })
		expect(hasValidSecretHeader(good)).toBe(true)

		expect(hasValidSecretHeader(new Headers({ "x-webhook-secret": "" }))).toBe(
			false,
		)
		expect(hasValidSecretHeader(new Headers({ "x-webhook-secret": "x" }))).toBe(
			false,
		)
		expect(
			hasValidSecretHeader(
				new Headers({ "x-webhook-secret": WEBHOOK_SECRET.slice(0, -1) }),
			),
		).toBe(false)
		expect(
			hasValidSecretHeader(
				new Headers({ "x-webhook-secret": `${WEBHOOK_SECRET}a` }),
			),
		).toBe(false)
		expect(hasValidSecretHeader(new Headers())).toBe(false)
	})
})

describe("the retired HMAC cookie", () => {
	test("is no longer a credential", async () => {
		// The cookie NAME is kept only so logout can delete a stale one. Nothing
		// authorizes against it any more — that was the whole point: the value
		// was the literal "admin" for every login, so it proved only that a login
		// had happened once, not who was signed in.
		expect(COOKIE_NAME).toBe("mcpedia_admin")

		const exports = await import("./auth")
		expect(Object.keys(exports)).not.toContain("verifyCookie")
		expect(Object.keys(exports)).not.toContain("signCookie")
	})
})
