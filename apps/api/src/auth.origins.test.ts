/**
 * trustedOrigins must cover BOTH public hostnames.
 *
 * ## THE BUG THIS LOCKS DOWN
 *
 * better-auth derives `trustedOrigins` from `baseURL` when the option is absent,
 * so a single BETTER_AUTH_URL trusts exactly one hostname. Caddy serves the same
 * app — same SPA, same API on :4020, same session cookie name — from BOTH
 * `wiki.asepharyana.my.id` and `mcpedia.asepharyana.my.id`, which is an explicit
 * alias. With only one hostname trusted, signing in on the other succeeds and is
 * then treated as signed out: no error, no failed request, the cookie simply
 * ignored. That is a strictly worse failure than a hard 401 because every layer
 * above it reports success.
 *
 * The same gap had a second face: Caddy had no `handle /api/auth/*` at all, so
 * the request fell through to the SPA catch-all and came back as index.html with
 * a 200. That config is host state, not code, so it cannot be asserted here —
 * but the origins this test pins are what that route depends on once it exists.
 */

import { afterEach, describe, expect, test, vi } from "vitest"

const HOSTS = [
	"https://wiki.asepharyana.my.id",
	"https://mcpedia.asepharyana.my.id",
] as const

afterEach(() => {
	vi.unstubAllEnvs()
	vi.resetModules()
})

async function trustedOriginsFor(
	env: Record<string, string | undefined>,
): Promise<string[]> {
	vi.resetModules()
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) vi.stubEnv(key, undefined as unknown as string)
		else vi.stubEnv(key, value)
	}
	const { getAuth } = await import("./auth")
	// better-auth keeps its resolved options on the instance; reading the config
	// back is the only way to assert what the option actually became rather than
	// what we passed in — the two differ, which is the whole bug.
	const auth = getAuth() as unknown as {
		trustedOrigins?: string[]
		options?: { trustedOrigins?: string[] }
	}
	return auth.trustedOrigins ?? auth.options?.trustedOrigins ?? []
}

describe("trustedOrigins", () => {
	test("includes every public hostname, not only BETTER_AUTH_URL", async () => {
		const origins = await trustedOriginsFor({
			BETTER_AUTH_SECRET: "s".repeat(32),
			BETTER_AUTH_URL: HOSTS[0],
			DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
		})
		for (const host of HOSTS) {
			expect(origins).toContain(host)
		}
	})

	test("keeps BETTER_AUTH_URL first so callbacks stay absolute", async () => {
		const origins = await trustedOriginsFor({
			BETTER_AUTH_SECRET: "s".repeat(32),
			BETTER_AUTH_URL: HOSTS[0],
			DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
		})
		// better-auth builds callback URLs from baseURL, not from the list, so
		// the canonical host has to lead the array.
		expect(origins[0]).toBe(HOSTS[0])
	})

	test("a non-public BETTER_AUTH_URL does not shrink the list", async () => {
		// Someone setting the loopback default must not silently untrust the
		// two real hostnames — that is exactly the production regression.
		const origins = await trustedOriginsFor({
			BETTER_AUTH_SECRET: "s".repeat(32),
			BETTER_AUTH_URL: "http://127.0.0.1:4020",
			DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db",
		})
		for (const host of HOSTS) {
			expect(origins).toContain(host)
		}
	})
})
