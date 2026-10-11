import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { sql } from "drizzle-orm"
import { db, schema } from "@mcpedia/db"
import {
	BETTER_AUTH_SECRET,
	BETTER_AUTH_URL,
	requireEnv,
} from "@mcpedia/config"

/**
 * The better-auth server: the single source of truth for web authentication.
 *
 * ## Why this replaced the HMAC cookie
 *
 * `apps/web/app/lib/auth.ts` used to mint an `mcpedia_admin` cookie as
 * `admin.<hmac(ADMIN_PASSWORD)>`. That was a real signature, but it was not a
 * session: it never expired server-side, it was not revocable, and every login
 * produced the same cookie value, so there was no way to tell sessions apart or
 * to end one without changing the password. better-auth issues a per-session
 * random token backed by the `session` table, which expires, is revocable, and
 * carries the user's identity (and therefore the `role`) with it.
 *
 * ## The secret
 *
 * BETTER_AUTH_SECRET has NO fallback. An earlier version of this repo shipped a
 * literal fallback HMAC key in source, which meant any deployment that had not
 * configured a secret accepted forged admin cookies. `requireEnv` throws with a
 * message naming the variable instead. The auth object is built lazily, on
 * first use, so `next build` still works without a secret present (the SSG pass
 * imports this module with no .env).
 *
 * ## SCOPE
 *
 * This path governs the WEB UI only. The MCP write gate and apps/api keep using
 * the `x-webhook-secret` header: stdio MCP has no user session, so there is
 * nothing for a cookie to carry. Do not "unify" the two — that would reopen the
 * bypasses fixed in 177e015 / 804e9e3.
 */

/**
 * betterAuth is generic over its options, so the concrete type depends on the
 * literal config below. Naming it once keeps the cache, the return type and the
 * session helper in agreement — annotating each as `ReturnType<typeof
 * betterAuth>` (i.e. `Auth<BetterAuthOptions>`) is a different type and fails to
 * assign.
 */
type WebAuth = ReturnType<typeof buildAuth>

let cached: WebAuth | null = null

/** The base URL better-auth uses to build absolute callback URLs. */
function baseURL(): string {
	if (BETTER_AUTH_URL) return BETTER_AUTH_URL
	if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
	return "http://localhost:4016"
}

export function getAuth(): WebAuth {
	if (cached) return cached

	// Throws with a nameable message when unset. No fallback key, ever.
	const secret = requireEnv("BETTER_AUTH_SECRET", BETTER_AUTH_SECRET)

	cached = buildAuth(secret)
	return cached
}

/**
 * Construct the auth object. Separate from getAuth so its (option-generic)
 * return type is INFERRED and `WebAuth` can be named from it. Annotating it
 * `ReturnType<typeof betterAuth>` would pin it to the default
 * `Auth<BetterAuthOptions>` instantiation, which the concrete config below is
 * not assignable to.
 */
function buildAuth(secret: string) {
	return betterAuth({
		secret,
		baseURL: baseURL(),
		// Single-tenant email/password. No social providers are configured, so
		// the only way to obtain an `account` row is credential sign-up.
		emailAndPassword: {
			enabled: true,
			minPasswordLength: 12,
		},
		database: drizzleAdapter(db, {
			provider: "pg",
			// The auth tables only. Naming them keeps it obvious that
			// documents / document_chunks / document_revisions are not part of
			// the auth model.
			schema: {
				user: schema.user,
				session: schema.session,
				account: schema.account,
				verification: schema.verification,
			},
		}),
		user: {
			additionalFields: {
				// better-auth WRITES this field, so the runtime schema check
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
			expiresIn: 60 * 60 * 24 * 7, // 7 days, matching the retired cookie
			updateAge: 60 * 60 * 24,
		},
		advanced: {
			cookiePrefix: "mcpedia",
		},
		databaseHooks: {
			user: {
				create: {
					// Single-tenant bootstrap: the FIRST user to sign up becomes
					// the admin; everyone after is a plain "user".
					//
					// This is the one place a role is ever granted from the web
					// path, and it is deliberately narrow. There is no public
					// signup that grants admin unconditionally (that would be a
					// privilege-escalation bug), and no endpoint that promotes.
					// To add an admin later, insert or UPDATE the row directly —
					// see README, "Promoting a user to admin".
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

/** Next's request headers, imported lazily so this module stays testable. */
async function requestHeaders(): Promise<Headers> {
	const { headers } = await import("next/headers")
	return await headers()
}

export type WebSession = Awaited<ReturnType<WebAuth["api"]["getSession"]>>

/**
 * The session for the current request, or null.
 *
 * Returns null rather than throwing when the session is absent or the database
 * is unreachable: "not signed in" and "cannot tell" must both read as "no", or
 * an outage turns every page into an error. Callers that must distinguish
 * should use getSessionOrThrow.
 */
export async function getSession(): Promise<WebSession> {
	try {
		return await getAuth().api.getSession({ headers: await requestHeaders() })
	} catch {
		return null
	}
}

/** Same, but rethrows — use where a DB outage must not read as a logout. */
export async function getSessionOrThrow(): Promise<WebSession> {
	return await getAuth().api.getSession({ headers: await requestHeaders() })
}

/**
 * Whether the request carries a valid session with the `admin` role.
 *
 * Reads the role from the session's user row rather than trusting anything the
 * browser sent, which is what retiring the HMAC cookie bought: the old cookie
 * was a boolean with no identity behind it, so every authenticated caller was
 * indistinguishable from the admin.
 *
 * Fails closed. An unconfigured BETTER_AUTH_SECRET throws inside requireEnv,
 * which propagates — an auth path that cannot verify anything must not return
 * true.
 */
export async function isAdmin(): Promise<boolean> {
	const session = await getSessionOrThrow()
	const user = session?.user as { role?: string } | undefined
	return user?.role === "admin"
}
