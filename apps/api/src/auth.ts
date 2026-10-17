/**
 * better-auth, mounted on the API app.
 *
 * ## WHY THIS MOVED HERE
 *
 * The web session used to live entirely inside the Next app: apps/web served
 * /api/auth/* from its own route handler and checked the session inside a
 * server component. That arrangement cannot outlive the cutover to a SPA —
 * the SPA serves no route handlers, so the browser's only reachable auth
 * endpoint would be whatever the edge forwards to the API.
 *
 * So the session is now resolved by the API, which is already the only process
 * that holds a database connection and is already the only process that
 * authorizes writes. The Next app's copy (apps/web/app/lib/auth-server.ts) is
 * deleted with the rest of app/; nothing else depends on it.
 *
 * ## LAZY, AND WHY
 *
 * Built on first REQUEST, never at module scope. betterAuth() throws through
 * requireEnv when BETTER_AUTH_SECRET is unset, and apps/api/src/app.test.ts
 * constructs the app with injected fakes and no .env present — a module-scope
 * throw would take the whole suite down for a reason unrelated to what it
 * tests. The secret is still REQUIRED: it is checked when a request arrives,
 * and the error names the variable.
 *
 * ## THE BOOTSTRAP RULE
 *
 * The first account to sign up becomes the admin; every account after is a
 * plain "user". That rule is unchanged from apps/web/app/lib/auth-server.ts —
 * it was moved, not rewritten. There is deliberately no public signup that
 * grants admin unconditionally, and no endpoint that promotes: to add an admin
 * later, UPDATE the row directly (README, "Promoting a user to admin").
 */

import {
	BETTER_AUTH_SECRET,
	BETTER_AUTH_URL,
	requireEnv,
} from "@mcpedia/config"
import { db, schema } from "@mcpedia/db"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { sql } from "drizzle-orm"

/**
 * betterAuth is generic over its options, so the concrete type depends on the
 * literal config below. Naming it once keeps the cache, the return type and the
 * session helper in agreement — annotating each as `ReturnType<typeof
 * betterAuth>` is a different instantiation and fails to assign.
 */
type ApiAuth = ReturnType<typeof buildAuth>

let cached: ApiAuth | null = null

/** The base URL better-auth uses to build absolute callback URLs. */
function baseURL(): string {
	if (BETTER_AUTH_URL) return BETTER_AUTH_URL
	if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
	// The API's own default bind port (API_PORT ?? 4020). better-auth only needs
	// an absolute URL to build callbacks; in the deployed topology the browser
	// talks to Caddy, and BETTER_AUTH_URL is what keeps that correct.
	return "http://127.0.0.1:4020"
}

export function getAuth(): ApiAuth {
	if (cached) return cached
	// Throws with a nameable message when unset. No fallback key, ever.
	const secret = requireEnv("BETTER_AUTH_SECRET", BETTER_AUTH_SECRET)
	cached = buildAuth(secret)
	return cached
}

/**
 * Construct the auth object, separate from getAuth so its (option-generic)
 * return type is INFERRED and `ApiAuth` can be named from it.
 */
function buildAuth(secret: string) {
	return betterAuth({
		secret,
		baseURL: baseURL(),
		// better-auth derives trustedOrigins from baseURL when the option is
		// absent, so BETTER_AUTH_URL alone would trust exactly ONE hostname.
		//
		// Both of these serve the same app from the same Caddy blocks:
		// mcpedia.asepharyana.my.id is an explicit alias of wiki. — same SPA,
		// same API on :4020, same session cookie name. So a session established on
		// one must be honoured on the other, or the user signs in successfully and
		// the very next navigation reports them as signed out. That is worse than
		// a hard failure: nothing errors, the cookie is simply ignored.
		//
		// baseURL stays first because better-auth uses it to build absolute
		// callback URLs; this list is an addition, not a replacement.
		trustedOrigins: [
			baseURL(),
			"https://wiki.asepharyana.my.id",
			"https://mcpedia.asepharyana.my.id",
		],
		// Single-tenant email/password. No social providers are configured, so the
		// only way to obtain an `account` row is credential sign-up.
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 12,
		},
		database: drizzleAdapter(db, {
			provider: "pg",
			// The auth tables only. Naming them keeps it obvious that
			// documents / document_chunks / document_revisions are not part of the
			// auth model.
			schema: {
				user: schema.user,
				session: schema.session,
				account: schema.account,
				verification: schema.verification,
			},
		}),
		user: {
			additionalFields: {
				// better-auth WRITES this field, so its runtime schema check
				// (`diffSchema`) does not flag it as a required column it never
				// populates. The column also carries a DEFAULT in Drizzle.
				role: {
					type: "string",
					required: false,
					defaultValue: "user",
					input: false,
				},
			},
		},
		session: {
			expiresIn: 60 * 60 * 24 * 7, // 7 days
			updateAge: 60 * 60 * 24,
		},
		advanced: {
			cookiePrefix: "mcpedia",
		},
		databaseHooks: {
			user: {
				create: {
					// Single-tenant bootstrap: FIRST user to sign up becomes admin.
					before: async (user) => {
						const existing = await db.execute(sql`
							select 1 as present from "user" limit 1
						`)
						const rows = Array.isArray(existing)
							? existing
							: ((existing as { rows?: unknown[] }).rows ?? [])
						if (rows.length === 0) {
							return { data: { ...user, role: "admin" } }
						}
						return { data: { ...user, role: "user" } }
					},
				},
			},
		},
	})
}

export type ApiSession = Awaited<ReturnType<ApiAuth["api"]["getSession"]>>

/**
 * The session carried by a request's cookies, or null.
 *
 * The cookie is forwarded VERBATIM from the request headers. better-auth's
 * session cookie is an HMAC over `{...sessionData, expiresAt}` and carries no
 * host binding (read in the installed dist/cookies/index.mjs), so the `Cookie`
 * header is all it needs — which is also why this works unchanged behind Caddy,
 * where the `host` header is rewritten to the site address.
 *
 * Returns null rather than throwing on any failure. "Not signed in" and "cannot
 * tell" must both read as "no": an unconfigured BETTER_AUTH_SECRET or an
 * unreachable database means an outage must not turn every page into an error,
 * and a caller that must distinguish should use getSessionOrThrow.
 */
export async function getSessionForRequest(
	request: Request,
): Promise<ApiSession> {
	try {
		return await getAuth().api.getSession({ headers: request.headers })
	} catch {
		return null
	}
}

/** Same, but rethrows — use where a DB outage must not read as a logout. */
export async function getSessionOrThrow(request: Request): Promise<ApiSession> {
	return await getAuth().api.getSession({ headers: request.headers })
}

/**
 * Whether the request carries a valid session whose user has the `admin` role.
 *
 * Reads the role from the session's user row rather than trusting anything the
 * browser sent, and fails closed: an auth path that cannot verify anything must
 * not return true.
 */
export async function isAdminRequest(request: Request): Promise<boolean> {
	const session = await getSessionForRequest(request)
	const user = session?.user as { role?: string } | undefined
	return user?.role === "admin"
}
