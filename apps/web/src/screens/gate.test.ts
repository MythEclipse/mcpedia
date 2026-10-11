import { describe, expect, it } from "vitest"
import { isAdmin, shouldRedirectToLogin } from "./gate"
import { DEFAULT_SECTION, sectionIdsFrom } from "../lib/sections"
import type { MeResponse } from "../lib/api-client"

/**
 * The gate, and the one piece of loader logic in /create.
 *
 * These assert the CLIENT half of the gate only. The authoritative half is
 * requireWriteAuth in apps/api/src/presentation/middleware.ts, which no test
 * here can reach or weaken — a client-side redirect is a suggestion, and this
 * file is the reminder of that.
 */

function me(overrides: Partial<MeResponse> = {}): MeResponse {
	return {
		authenticated: true,
		role: "admin",
		via: "webhook-secret",
		...overrides,
	}
}

describe("isAdmin", () => {
	it("accepts an authenticated admin", () => {
		expect(isAdmin(me())).toBe(true)
	})

	it("rejects an authenticated NON-admin", () => {
		// Signed in but not an admin is a legitimate state: read everything,
		// write nothing. Gating on `authenticated` alone would render an editor
		// whose only possible outcome is a 401.
		expect(isAdmin(me({ role: null }))).toBe(false)
		expect(isAdmin(me({ role: "user" as MeResponse["role"] }))).toBe(false)
	})

	it("rejects an unauthenticated caller", () => {
		expect(isAdmin(me({ authenticated: false, role: null, via: null }))).toBe(
			false,
		)
	})

	it("rejects a null, which is what a failed auth.me resolves to", () => {
		// "Cannot tell" must read as "no": otherwise a dead API renders the
		// editor and the user only discovers the problem at submit time.
		expect(isAdmin(null)).toBe(false)
	})

	it("does not trust authenticated without a role", () => {
		expect(isAdmin(me({ role: null }))).toBe(false)
	})
})

describe("shouldRedirectToLogin", () => {
	it("redirects an anonymous visitor", () => {
		expect(
			shouldRedirectToLogin(me({ authenticated: false, role: null })),
		).toBe(true)
		expect(shouldRedirectToLogin(null)).toBe(true)
	})

	it("redirects a signed-in non-admin", () => {
		expect(shouldRedirectToLogin(me({ role: null }))).toBe(true)
	})

	it("lets an admin through", () => {
		expect(shouldRedirectToLogin(me())).toBe(false)
	})
})

describe("sectionIdsFrom", () => {
	it("takes the ids out of the sections payload", () => {
		expect(
			sectionIdsFrom([
				{ id: "docs", label: "Docs", icon: "", desc: "", docCount: 3 },
				{ id: "notes", label: "Notes", icon: "", desc: "", docCount: 1 },
			]),
		).toEqual(["docs", "notes"])
	})

	it("deduplicates", () => {
		// The API's sections and the built-in defaults overlap heavily, and the
		// datalist is a Set anyway — but the loader's contract is "unique ids".
		expect(
			sectionIdsFrom([
				{ id: "docs", label: "Docs", icon: "", desc: "", docCount: 3 },
				{ id: "docs", label: "Docs", icon: "", desc: "", docCount: 3 },
			]),
		).toEqual(["docs"])
	})

	it("skips malformed entries instead of taking the route down", () => {
		expect(
			sectionIdsFrom([
				{ id: "", label: "Empty", icon: "", desc: "", docCount: 0 },
				{ id: "docs", label: "Docs", icon: "", desc: "", docCount: 1 },
			]),
		).toEqual(["docs"])
	})

	it("survives a null or missing payload", () => {
		// The loader catches a failed documents.sections and passes [] — and a
		// route must render with no sections rather than crash on the form.
		expect(sectionIdsFrom([])).toEqual([])
		expect(sectionIdsFrom(null as never)).toEqual([])
		expect(sectionIdsFrom([null, undefined])).toEqual([])
	})

	it("preserves API order", () => {
		expect(
			sectionIdsFrom([
				{ id: "zeta", label: "Z", icon: "", desc: "", docCount: 0 },
				{ id: "alpha", label: "A", icon: "", desc: "", docCount: 0 },
			]),
		).toEqual(["zeta", "alpha"])
	})
})

describe("DEFAULT_SECTION", () => {
	it("is one of the section defaults the form offers", () => {
		// The preloaded folder tree is fetched for this section; a value the
		// form could never select would be dead weight.
		expect(DEFAULT_SECTION).toBe("docs")
	})
})
