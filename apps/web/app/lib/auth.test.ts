import { describe, expect, test } from "vitest"
import { createHmac } from "node:crypto"
import { ADMIN_PASSWORD } from "@mcpedia/config"
import { COOKIE_VALUE, signCookie, verifyCookie } from "./auth"

// The web auth path had no tests at all: three copies of `isAuthorized` shipped a
// prefix-only cookie check (`startsWith("admin.")`) for months without anything
// failing. These cases pin the properties that actually matter.

/** Sign an arbitrary value the way signCookie would, to forge a well-signed cookie. */
const forge = (value: string) => forgeWith(ADMIN_PASSWORD || "fallback", value)

/** Sign with an explicit key, so tests can exercise the old "fallback" key. */
const forgeWith = (key: string, value: string) =>
	`${value}.${createHmac("sha256", key).update(value).digest("hex")}`

describe("verifyCookie", () => {
	test("accepts a correctly signed admin cookie", () => {
		if (!ADMIN_PASSWORD) return // covered by the unset-password test below
		expect(verifyCookie(signCookie(COOKIE_VALUE))).toBe(true)
	})

	test("refuses to sign or verify when ADMIN_PASSWORD is unset", () => {
		// signCookie used to fall back to the literal string "fallback" — a
		// hardcoded key committed to the repo. Anyone could mint a valid admin
		// cookie for an unconfigured deployment. It must now throw instead,
		// and verification must read that as "not authenticated", not a 500.
		if (ADMIN_PASSWORD) {
			expect(signCookie(COOKIE_VALUE)).toBeTruthy()
			return
		}
		expect(() => signCookie(COOKIE_VALUE)).toThrow(/ADMIN_PASSWORD/)
		// No crash, and definitely not authenticated:
		expect(verifyCookie(`${COOKIE_VALUE}.deadbeef`)).toBe(false)
		// A cookie signed with the old hardcoded fallback must not verify:
		const forged = forgeWith("", COOKIE_VALUE)
		expect(verifyCookie(forged)).toBe(false)
	})

	test("rejects the old prefix bypass", () => {
		expect(verifyCookie("admin.deadbeef")).toBe(false)
		expect(verifyCookie("admin.")).toBe(false)
		expect(verifyCookie("admin.whatever")).toBe(false)
	})

	test("rejects a validly signed cookie for a different value", () => {
		// The signature only proves the caller knows ADMIN_PASSWORD. Without
		// binding the value, forge("root") would authenticate as the admin.
		expect(verifyCookie(forge("root"))).toBe(false)
		expect(verifyCookie(forge(""))).toBe(false)
		expect(verifyCookie(forge(`${COOKIE_VALUE}2`))).toBe(false)
	})

	test("rejects a truncated or extended signature", () => {
		if (!ADMIN_PASSWORD) return // nothing can be signed without a key
		const good = signCookie(COOKIE_VALUE)
		expect(verifyCookie(good.slice(0, -1))).toBe(false)
		expect(verifyCookie(`${good}a`)).toBe(false)
		expect(verifyCookie(`${good}.extra`)).toBe(false)
	})

	test("rejects structurally invalid cookies", () => {
		expect(verifyCookie(undefined)).toBe(false)
		expect(verifyCookie("")).toBe(false)
		expect(verifyCookie(COOKIE_VALUE)).toBe(false) // no signature
		expect(verifyCookie(`.${forge("").split(".")[1]}`)).toBe(false) // no value
	})
})
