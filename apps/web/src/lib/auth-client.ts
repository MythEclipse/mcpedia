/**
 * Browser-side authentication. HTTP only — this file must never import
 * auth-server.
 *
 * apps/web/app/lib/auth-server.ts builds the betterAuth() instance against
 * @mcpedia/db and next/headers. Importing it here would pull the Postgres
 * driver and node:fs into the browser bundle; the build-time guard
 * (src/build/no-server-imports.ts) exists precisely to make that a build error
 * rather than a runtime surprise. So the SPA owns a CLIENT, and the server
 * instance stays on the server. This mirrors app/lib/auth-client.ts on the
 * Next side, which already does exactly this.
 *
 * ## THE ENDPOINT
 *
 * `basePath` is /api/auth — better-auth's own catch-all, and the same path
 * vite.config.ts proxies and the same path the API is specified to serve (see
 * the contract note in api-client.ts). It is spelled out rather than left to
 * better-auth's default so the value has one place to change if the mount moves.
 *
 * The default credentials: "include" that better-auth applies is what keeps the
 * session cookie first-party. It is left alone rather than overridden.
 */

/* eslint-disable import/no-extraneous-dependencies */
// better-auth is a real dependency of apps/web (package.json), so this is a
// normal import, not a devDependency reaching into production.
import { createAuthClient } from "better-auth/react"
import { AUTH_BASE_PATH } from "./auth-config"
import type { Session } from "./gate-session"

export { AUTH_BASE_PATH, AUTH_BASE_URL } from "./auth-config"
export { isAdminSession } from "./gate-session"
export type { Role, Session } from "./gate-session"

export const authClient = createAuthClient({
	// `basePath`, NOT `baseURL`. A relative baseURL is rejected by better-auth's
	// getBaseURL -> withPath -> assertHasProtocol, which requires an absolute
	// http(s) URL and throws "Invalid base URL: /api/auth" otherwise — at
	// construction, so the whole module fails to load. basePath is the origin-relative
	// form, which is what a same-origin SPA wants anyway.
	basePath: AUTH_BASE_PATH,
})

/**
 * The current session, or null.
 *
 * Returns null rather than throwing on any failure — including "the API is
 * down" and "BETTER_AUTH_SECRET is not configured". That matches the Next
 * app's getSession() (app/lib/auth-server.ts): "not signed in" and "cannot
 * tell" must both read as "no", or an outage turns every page into an error.
 */
export async function getSession(): Promise<Session | null> {
	try {
		const result = await authClient.getSession()
		// better-auth answers 200 with data:null when there is no session.
		return (result?.data as Session | null) ?? null
	} catch {
		return null
	}
}

/**
 * Sign in, returning the error message instead of throwing.
 *
 * better-auth reports a rejected password as a resolved `{ error }`, not a
 * rejection, so callers must check `.error` either way; normalizing to a string
 * keeps the login form from having to know that.
 */
export async function signIn(
	email: string,
	password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	try {
		const result = await authClient.signIn.email({
			email: email.trim(),
			password,
		})
		if (result.error) {
			return {
				ok: false,
				error: result.error.message ?? "Authentication failed.",
			}
		}
		return { ok: true }
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

/** Create an account. The first user becomes the admin; later ones do not. */
export async function signUp(
	email: string,
	password: string,
	name: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	try {
		const result = await authClient.signUp.email({
			email: email.trim(),
			password,
			name: name.trim() || email.trim(),
		})
		if (result.error) {
			return {
				ok: false,
				error: result.error.message ?? "Authentication failed.",
			}
		}
		return { ok: true }
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		}
	}
}

/** End the session. */
export async function signOut(): Promise<void> {
	try {
		await authClient.signOut()
	} catch {
		// A failed sign-out leaves the cookie in place; there is nothing the
		// caller can do about it and the next session check will still be honest.
	}
}
