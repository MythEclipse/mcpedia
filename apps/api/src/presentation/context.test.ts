import { asAppError } from "@mcpedia/core"
import { describe, expect, it } from "vitest"
import type { Session } from "./context"
import { canWrite, requireRole } from "./context"

/**
 * SINGLE-TENANT AUTHORIZATION.
 *
 * The point of these tests is not that a role check works — it is the two ways
 * a role check fails silently.
 *
 * 1. An unauthenticated caller must be UNAUTHORIZED (401), not merely
 *    forbidden (403). They have not proved who they are yet; telling them
 *    "you lack the role" leaks that the role exists and invites them to try
 *    again with a credential.
 *
 * 2. A signed-in non-admin must be FORBIDDEN (403), and must NOT be admitted.
 *    The sibling `roleOf()` in session.ts deliberately defaults an unrecognised
 *    role to "user" — correct for reporting, and exactly the kind of default
 *    that is wrong if reused for authorizing.
 */

const admin: Session = { role: "admin", via: "session" }
const plainUser: Session = { role: "user", via: "session" }
const viaSecret: Session = { role: "admin", via: "webhook-secret" }

const codeOf = (fn: () => unknown): string => {
	try {
		fn()
		throw new Error("expected the gate to refuse, but it returned")
	} catch (error) {
		const app = asAppError(error)
		if (!app) throw error
		return app.code
	}
}

describe("requireRole, single-tenant", () => {
	it("admits an admin and returns the session for further use", () => {
		expect(requireRole(admin)).toBe(admin)
	})

	it("admits an admin that arrived via the webhook secret", () => {
		// The MCP path carries no cookie; the role is what matters, not the route.
		expect(requireRole(viaSecret)).toBe(viaSecret)
	})

	it("refuses an unauthenticated caller as UNAUTHORIZED, not FORBIDDEN", () => {
		expect(codeOf(() => requireRole(null))).toBe("UNAUTHORIZED")
	})

	it("refuses a signed-in non-admin as FORBIDDEN", () => {
		expect(codeOf(() => requireRole(plainUser))).toBe("FORBIDDEN")
	})

	it("defaults to write-when-admin when no role is named", () => {
		expect(requireRole(admin)).toBe(admin)
		expect(codeOf(() => requireRole(plainUser))).toBe("FORBIDDEN")
	})

	it("honours an explicit role list", () => {
		expect(requireRole(plainUser, "user")).toBe(plainUser)
		// Naming "user" must NOT quietly keep admitting admin — the list is the
		// permission set, so excluding a role excludes it.
		expect(codeOf(() => requireRole(admin, "user"))).toBe("FORBIDDEN")
	})

	it("agrees with canWrite on the default policy", () => {
		// Two functions must not answer "may this caller write?" differently. If
		// someone widens one of them, this fails.
		expect(canWrite(admin)).toBe(true)
		expect(canWrite(plainUser)).toBe(false)
		expect(canWrite(null)).toBe(false)
		for (const session of [admin, plainUser, viaSecret]) {
			let admitted = true
			try {
				requireRole(session)
			} catch {
				admitted = false
			}
			expect(admitted).toBe(canWrite(session))
		}
	})
})
