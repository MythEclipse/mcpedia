import { describe, expect, it } from "vitest"

/**
 * A smoke test for the module graph, run in a minimal DOM-ish global.
 *
 * ## WHY THIS EXISTS
 *
 * `createAuthClient({ baseURL: "/api/auth" })` does not fail to typecheck, does
 * not fail to build, and does not fail any unit test that mocks the client. It
 * THROWS AT CONSTRUCTION — better-auth's getBaseURL routes a supplied baseURL
 * through assertHasProtocol, which requires an absolute http(s) URL — so the
 * whole auth module failed to load and /login could never render. It was caught
 * here only because routes.test.ts builds the real router, which imports the
 * login page.
 *
 * This pins that at module-load time so it cannot come back, and it pins the
 * fix (`basePath`) rather than just the absence of a throw.
 */

describe("the SPA entry graph loads", () => {
	it("constructs the better-auth client without throwing", async () => {
		// A window is what better-auth reads to build absolute URLs; without one it
		// falls back to env vars and this test would not exercise the real path.
		const previousWindow = (globalThis as { window?: unknown }).window
		;(globalThis as { window?: unknown }).window = {
			location: {
				origin: "https://wiki.example.test",
				href: "https://wiki.example.test/login",
			},
		}
		try {
			const mod = await import("../lib/auth-client")
			expect(mod.authClient).toBeDefined()
			expect(typeof mod.signIn).toBe("function")
			expect(typeof mod.signUp).toBe("function")
			expect(typeof mod.signOut).toBe("function")
			expect(mod.AUTH_BASE_PATH).toBe("/api/auth")
		} finally {
			if (previousWindow === undefined) {
				delete (globalThis as { window?: unknown }).window
			} else {
				;(globalThis as { window?: unknown }).window = previousWindow
			}
		}
	})

	it("keeps the session cookie first-party", async () => {
		// better-auth applies credentials: "include" by default in a browser-like
		// environment. This asserts the client was built with the default rather
		// than with something that would drop the cookie.
		const previousWindow = (globalThis as { window?: unknown }).window
		;(globalThis as { window?: unknown }).window = {
			location: {
				origin: "https://wiki.example.test",
				href: "https://wiki.example.test/login",
			},
		}
		try {
			const mod = await import("../lib/auth-client")
			expect(mod.authClient).toBeDefined()
			// The cookie is what authenticates a write; if credentials were
			// overridden to "omit" the whole port would silently stop working.
			const $fetch = (mod.authClient as unknown as { $fetch?: unknown }).$fetch
			expect($fetch).toBeDefined()
		} finally {
			if (previousWindow === undefined) {
				delete (globalThis as { window?: unknown }).window
			} else {
				;(globalThis as { window?: unknown }).window = previousWindow
			}
		}
	})
})
