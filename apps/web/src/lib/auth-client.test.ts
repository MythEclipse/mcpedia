import { afterEach, describe, expect, it, vi } from "vitest"
import { AUTH_BASE_URL } from "./auth-config"
import { isAdminSession, type Session } from "./gate-session"

/**
 * The browser/server boundary for auth, and the admin-role rule.
 *
 * ## WHY auth-server IS NOT UNDER TEST HERE
 *
 * apps/web/app/lib/auth-server.ts is the SERVER module: it builds betterAuth()
 * against @mcpedia/db and reads next/headers. Importing it from a test in src/
 * would pull the Postgres driver into a browser-shaped module graph, which is
 * precisely what src/build/no-server-imports.ts exists to prevent. It stays
 * testable where it lives — apps/web/app/lib/auth.test.ts covers it — and this
 * file covers only what the SPA owns.
 *
 * The constants are imported from ./auth-config rather than ./auth-client so
 * that importing createAuthClient (which touches nanostores and window) is not
 * needed to assert the endpoint contract.
 */

describe("AUTH_BASE_URL", () => {
	it("targets better-auth's catch-all on the SPA's own origin", () => {
		// Same-origin is load-bearing: the session cookie is first-party, and a
		// cross-origin call would drop it. This is the path vite.config.ts proxies
		// in dev and the path the API is specified to serve (see api-client.ts).
		expect(AUTH_BASE_URL).toBe("/api/auth")
	})

	it("is not the Next route path that the SPA does not run", () => {
		// The Next app serves this path from app/api/auth/[...all]/route.ts. The
		// SPA must reach it over HTTP, not import the handler.
		expect(AUTH_BASE_URL.startsWith("/api/auth")).toBe(true)
	})
})

describe("isAdminSession", () => {
	const session = (role?: string): Session => ({
		user: { role, name: "Ada", email: "ada@example.com" },
		session: { id: "sess_1" },
	})

	it("accepts a session whose user is an admin", () => {
		expect(isAdminSession(session("admin"))).toBe(true)
	})

	it("rejects a session with no role", () => {
		// better-auth's user.role has a DB DEFAULT of "user", so an absent role
		// means the column was never populated — treat it as not-admin rather
		// than letting a truthy check through.
		expect(isAdminSession(session(undefined))).toBe(false)
		expect(isAdminSession(session(""))).toBe(false)
	})

	it("rejects a plain user", () => {
		// Every account after the first is a plain "user" (auth-server.ts
		// databaseHooks), so this is the common case, not an edge case.
		expect(isAdminSession(session("user"))).toBe(false)
	})

	it("rejects a null session", () => {
		expect(isAdminSession(null)).toBe(false)
	})

	it("rejects a user named 'admin' who is not an admin", () => {
		// The check reads role, never name or email: display fields are attacker
		// controlled at signup.
		expect(
			isAdminSession({ user: { role: "user", name: "admin", email: "a@b.c" } }),
		).toBe(false)
	})
})

describe("auth client is not the server module", () => {
	it("imports nothing server-side", () => {
		// A structural check on the SOURCE rather than on the loaded module:
		// importing auth-client.ts here would touch nanostores and `window`, and
		// the vitest environment is "node".
		//
		// Only import statements are examined — a doc comment that NAMES
		// auth-server.ts (which this file's own header does, explaining why it is
		// not used) is the opposite of a violation.
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const here = path.dirname(new URL(import.meta.url).pathname)
		const src = fs.readFileSync(path.join(here, "auth-client.ts"), "utf8")

		const imports = [
			...src.matchAll(/^\s*import\s[\s\S]*?from\s+["']([^"']+)["']/gm),
		]
			.map((m) => m[1])
			// A bare side-effect import (`import "x"`) has no `from`.
			.concat(
				[...src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)].map((m) => m[1]),
			)

		expect(imports.length).toBeGreaterThan(0)
		for (const spec of imports) {
			expect(spec, `auth-client.ts imports ${spec}`).not.toMatch(
				/auth-server|@mcpedia\/(db|config|core|queue)/,
			)
		}
	})

	it("imports the browser client, not the server builder", () => {
		const fs = require("node:fs") as typeof import("node:fs")
		const path = require("node:path") as typeof import("node:path")
		const here = path.dirname(new URL(import.meta.url).pathname)
		const src = fs.readFileSync(path.join(here, "auth-client.ts"), "utf8")

		expect(src).toMatch(/from\s+["']better-auth\/react["']/)
		// The bare "better-auth" entry is the SERVER entry point (it pulls
		// drizzle-orm and the database adapter); auth-server.ts uses it.
		expect(src).not.toMatch(/from\s+["']better-auth["']/)
	})
})

afterEach(() => {
	vi.restoreAllMocks()
})
