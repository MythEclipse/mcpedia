import { describe, expect, test } from "vitest"
import { createHmac } from "node:crypto"
import { ADMIN_PASSWORD } from "@mcpedia/config"
import { COOKIE_VALUE, signCookie, verifyCookie } from "./auth"

// The web auth path had no tests at all: three copies of `isAuthorized` shipped a
// prefix-only cookie check (`startsWith("admin.")`) for months without anything
// failing. These cases pin the properties that actually matter.

/** Sign an arbitrary value the way signCookie would, to forge a well-signed cookie. */
const forge = (value: string) =>
	`${value}.${createHmac("sha256", ADMIN_PASSWORD || "fallback").update(value).digest("hex")}`

describe("verifyCookie", () => {
	test("accepts a correctly signed admin cookie", () => {
		expect(verifyCookie(signCookie(COOKIE_VALUE))).toBe(true)
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