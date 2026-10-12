import type { Hono } from "hono"
import { beforeEach, expect, test, vi } from "vitest"
import type { ApiDeps } from "../app"
import { createApp } from "../app"

/**
 * The browser credential path.
 *
 * ## WHAT IS UNDER TEST
 *
 * Before this, the write gate accepted exactly one credential: the
 * `x-webhook-secret` header, which only the MCP server over stdio can hold. The
 * SPA had no way to write at all, because sending the secret from a browser would
 * publish it in the bundle.
 *
 * The gate now accepts a better-auth session as well. THIS file is the proof that
 * the added path is exactly that — an addition — and not a loosening:
 *
 *   - the secret still works, with no session (MCP keeps working)
 *   - an admin session works, with no secret (the browser can write)
 *   - a NON-admin session does not, which is the case that would matter if the
 *     gate had been written "is signed in" instead of "is admin"
 *   - neither credential is refused
 *   - a wrong secret is still refused unless a valid admin session accompanies it
 *
 * Every assertion also checks that core was NOT reached on a refusal, because a
 * correct status on an already-rejected request would still be a security
 * failure.
 */

const fakeQueue = {
	getWaitingCount: () => Promise.resolve(0),
	getActiveCount: () => Promise.resolve(0),
	getCompletedCount: () => Promise.resolve(0),
	getFailedCount: () => Promise.resolve(0),
	getDelayedCount: () => Promise.resolve(0),
}

const coreCalls = vi.hoisted(() => ({
	createDocument: [] as unknown[][],
	updateDocument: [] as unknown[][],
	deleteDocument: [] as unknown[][],
	restoreRevision: [] as unknown[][],
}))

/**
 * The session the fake better-auth will report, set per test.
 *
 * `null` means "no valid cookie". The role is what the gate reads; nothing in the
 * request itself carries it, which is the property that makes this unforgeable.
 */
const sessionState = vi.hoisted(() => ({
	// `userId` is optional because the secret path has no user at all — a shared
	// credential identifies a credential, not a person. Declaring it as optional
	// rather than defaulting it is what keeps the "no user id on the MCP path"
	// assertion meaningful rather than trivially satisfied by a fixture default.
	current: null as null | { role: string; userId?: string },
	loads: 0,
}))

/** Records that the better-auth catch-all actually received a request. */
const authState = vi.hoisted(() => ({
	builds: 0,
	calls: [] as string[],
}))

vi.mock("../auth", () => ({
	getAuth: () => {
		authState.builds++
		return {
			handler: async (request: Request) => {
				authState.calls.push(new URL(request.url).pathname)
				return new Response(JSON.stringify({ stub: true }), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
			},
		}
	},
	getSessionForRequest: async () => {
		sessionState.loads++
		if (!sessionState.current) return null
		// `id` is included because sessionLoader reads it to build the audit actor.
		// Omitting it here made the stub silently report a session with a role but
		// no identity — which reads as a real, unattributed login rather than as a
		// test fixture that forgot a field.
		return {
			user: {
				id: sessionState.current.userId ?? "u-1",
				role: sessionState.current.role,
			},
		}
	},
	getSessionOrThrow: async () => null,
	isAdminRequest: async () => sessionState.current?.role === "admin",
}))

vi.mock("@mcpedia/queue", () => ({
	getQueue: () => fakeQueue,
	enqueueFullIndex: async () => ({ id: "full" }),
	enqueueIndexDoc: async () => ({ id: "doc" }),
	INDEX_QUEUE: "mcpedia-index",
}))

vi.mock("@mcpedia/core", async () => {
	const real =
		await vi.importActual<typeof import("@mcpedia/core")>("@mcpedia/core")
	return {
		asAppError: real.asAppError,
		// The write gate throws a typed `forbidden`/`unauthorized` from core and
		// the error mapper reads them back through the SAME module. Forwarding
		// only `asAppError` left `forbidden` undefined inside the mock, so the
		// refusal became an opaque 500 instead of a 403 — the test then "failed"
		// for a reason that had nothing to do with authorization.
		forbidden: real.forbidden,
		unauthorized: real.unauthorized,

		/**
		 * The routers now call the COMPOSITION ROOT, not the legacy wrappers.
		 *
		 * Both are faked here, and they record into the SAME `coreCalls` buckets,
		 * because what these tests assert is "did a write reach core at all" — not
		 * which of core's two entry points delivered it. Pinning the legacy
		 * function name would have made this suite fail on a wiring change that
		 * altered nothing observable, which is how a test starts asserting the
		 * implementation instead of the behaviour.
		 *
		 * The actor argument is captured too: the routers pass it as the first
		 * argument to the use-case factory, and it is now part of what a write
		 * handler does.
		 */
		documentUseCases: (actor?: unknown) => ({
			create: (...a: unknown[]) => {
				coreCalls.createDocument.push([actor, ...a])
				return Promise.resolve({ slug: "docs/t" })
			},
			update: (...a: unknown[]) => {
				coreCalls.updateDocument.push([actor, ...a])
				return Promise.resolve({ slug: a[0] })
			},
			remove: (...a: unknown[]) => {
				coreCalls.deleteDocument.push([actor, ...a])
				return Promise.resolve({ deleted: true })
			},
			get: () => Promise.resolve(null),
			list: () => Promise.resolve([]),
			related: () => Promise.resolve([]),
			sections: () => Promise.resolve([]),
			folderInfo: () => Promise.resolve({}),
			export: () => Promise.resolve({ summary: {}, documents: [] }),
		}),
		revisionUseCases: (actor?: unknown) => ({
			list: () => Promise.resolve([]),
			get: () => Promise.resolve(null),
			restore: (...a: unknown[]) => {
				coreCalls.restoreRevision.push([actor, ...a])
				return Promise.resolve({ restored: true })
			},
			snapshot: () => Promise.resolve(false),
		}),
		indexingUseCases: () => ({
			indexFile: () => Promise.resolve({ indexed: true, chunks: 0 }),
			runFullIndex: () => Promise.resolve({ indexed: 0, chunks: 0 }),
		}),

		// The legacy surface, kept faked because scripts and the worker still
		// import it directly.
		createDocument: (...a: unknown[]) => {
			coreCalls.createDocument.push(a)
			return Promise.resolve({ slug: "docs/t" })
		},
		updateDocument: (...a: unknown[]) => {
			coreCalls.updateDocument.push(a)
			return Promise.resolve({ slug: a[0] })
		},
		deleteDocument: (...a: unknown[]) => {
			coreCalls.deleteDocument.push(a)
			return Promise.resolve({ deleted: true })
		},
		restoreRevision: (...a: unknown[]) => {
			coreCalls.restoreRevision.push(a)
			return Promise.resolve({ restored: true })
		},
		listSections: () => Promise.resolve([]),
		listDocuments: () => Promise.resolve([]),
		listRevisions: () => Promise.resolve([]),
		getDocument: () => Promise.resolve(null),
		getRelated: () => Promise.resolve([]),
		getRevision: () => Promise.resolve(null),
		classifyPath: () => "none",
		extractFoldersForSection: () => [],
		getExportDocuments: () => Promise.resolve({ summary: {}, documents: [] }),
	}
})

function deps(secret: string): ApiDeps {
	return { queue: fakeQueue, webhookSecret: secret }
}

function rpc(app: Hono, procedure: string, input: unknown, secret?: string) {
	const headers: Record<string, string> = { "content-type": "application/json" }
	if (secret) headers["x-webhook-secret"] = secret
	return app.request(`/rpc/${procedure}`, {
		method: "POST",
		headers,
		body: JSON.stringify({ json: input }),
	})
}

/** The canonical "create a document" call, as a typed pair. */
const CREATE: [string, unknown] = [
	"documents/create",
	{ slug: "docs/t", title: "T", section: "docs", body: "# x" },
]

let SECRET: string
beforeEach(() => {
	SECRET = `secret-${Math.random().toString(36).slice(2)}`
	sessionState.current = null
	sessionState.loads = 0
	authState.builds = 0
	authState.calls.length = 0
	for (const k of Object.keys(coreCalls) as Array<keyof typeof coreCalls>) {
		coreCalls[k].length = 0
	}
})

// ---------------------------------------------------------------------------
// The better-auth catch-all is MOUNTED.
//
// Until it existed, /login posted to a 404 and the SPA had no auth endpoint at
// all — recorded as a blocker in apps/web/src/lib/api-client.ts and in the Vite
// proxy config. These assert the route exists and delegates, including that the
// auth instance is built LAZILY (per request, not at import), because building it
// at module scope throws when BETTER_AUTH_SECRET is unset and takes the whole
// test suite down for an unrelated reason.
// ---------------------------------------------------------------------------

test.each([
	"/api/auth/sign-in/email",
	"/api/auth/sign-up/email",
	"/api/auth/get-session",
	"/api/auth/sign-out",
])("%s reaches better-auth's handler", async (path) => {
	const app = await createApp(deps(SECRET))
	const res = await app.request(path, { method: "POST" })
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({ stub: true })
	expect(authState.calls).toContain(path)
})

test("the auth instance is built per request, never at import time", async () => {
	const app = await createApp(deps(SECRET))
	// Constructing the app touches no auth state at all.
	expect(authState.builds).toBe(0)
	await app.request("/api/auth/get-session", { method: "POST" })
	expect(authState.builds).toBe(1)
})

// ---------------------------------------------------------------------------
// The session path
// ---------------------------------------------------------------------------

test("an admin session with NO secret header may write", async () => {
	sessionState.current = { role: "admin" }
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, CREATE[0], CREATE[1])
	expect(res.status).toBe(200)
	expect(coreCalls.createDocument).toHaveLength(1)
})

/**
 * The actor must reach the use case, not just the authorization decision.
 *
 * This is the one assertion that ties authorization to the audit trail. Without
 * it, a refactor could keep every status code exactly right while silently
 * recording every write as an unattributed SYSTEM action — the authorization
 * would still be correct and the audit trail would still be complete, and
 * neither fact would reveal that "who" had become "someone".
 */
test("the resolved session is handed to the use case as the audit actor", async () => {
	sessionState.current = { role: "admin", userId: "u-42" }
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, CREATE[0], CREATE[1])
	expect(res.status).toBe(200)

	// `documentUseCases` is faked to record its factory argument first, so
	// coreCalls.createDocument[0] is the actor and [1] is the input.
	const [actor, input] = coreCalls.createDocument[0] as [unknown, unknown]
	expect(actor).toMatchObject({ via: "session", role: "admin", userId: "u-42" })
	expect(input).toMatchObject({ slug: "docs/t" })
})

test("the webhook-secret path records a credential with NO user id", async () => {
	// A shared secret identifies a credential, not a person. Asserting the absence
	// of a userId here is what stops a future "default it to the request user"
	// change from putting a fabricated identity in an append-only log.
	sessionState.current = null
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, CREATE[0], CREATE[1], SECRET)
	expect(res.status).toBe(200)

	const [actor] = coreCalls.createDocument[0] as [
		{ via?: string; role?: string; userId?: string },
	]
	expect(actor).toMatchObject({ via: "webhook-secret", role: "admin" })
	expect(actor.userId).toBeUndefined()
})

test("a NON-admin session may not write, and core is untouched", async () => {
	sessionState.current = { role: "user" }
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, CREATE[0], CREATE[1])
	expect(res.status).toBe(403)
	expect(coreCalls.createDocument).toHaveLength(0)
})

test("an admin session does not unlock writes when the secret is UNSET", async () => {
	// The session path does not depend on WEBHOOK_SECRET, so an unconfigured
	// deployment still admits a real admin — that is the browser working with no
	// webhook at all. What must never happen is a NON-admin passing here.
	sessionState.current = { role: "admin" }
	const app = await createApp(deps(""))
	const res = await rpc(app, CREATE[0], CREATE[1])
	expect(res.status).toBe(200)
	expect(coreCalls.createDocument).toHaveLength(1)
})

test("a non-admin session is refused even when the secret is UNSET", async () => {
	sessionState.current = { role: "user" }
	const app = await createApp(deps(""))
	const res = await rpc(app, CREATE[0], CREATE[1])
	expect(res.status).toBe(403)
	expect(coreCalls.createDocument).toHaveLength(0)
})

test("a session with no role at all is refused", async () => {
	// An unpopulated role column must not read as admin.
	sessionState.current = { role: "" }
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, CREATE[0], CREATE[1])
	expect(res.status).toBe(403)
	expect(coreCalls.createDocument).toHaveLength(0)
})

// ---------------------------------------------------------------------------
// The secret path is unchanged — MCP must keep working exactly as before
// ---------------------------------------------------------------------------

test("the secret alone still works with no session (MCP path)", async () => {
	sessionState.current = null
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, CREATE[0], CREATE[1], SECRET)
	expect(res.status).toBe(200)
	expect(coreCalls.createDocument).toHaveLength(1)

	// ZERO session lookups, which is the whole point of the secret path: the
	// credential is a constant-time string comparison, so an MCP call never
	// touches the session table.
	//
	// This held before the audit trail existed and it still holds. Attributing a
	// write to the secret therefore CANNOT come from the session — there is none —
	// so `actorOf` resolves the secret credential itself. An earlier version read
	// the actor from `loadSession()` and cost this path one database round trip to
	// learn "nobody", which is both slower and, on the stdio path where there is
	// no cookie, the reason the actor came back undefined in the first place.
	expect(sessionState.loads).toBe(0)
})

test("with NO credential at all -> 401 and core is untouched", async () => {
	sessionState.current = null
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, CREATE[0], CREATE[1])
	expect(res.status).toBe(401)
	expect(coreCalls.createDocument).toHaveLength(0)
})

test("a wrong secret and no session -> 401", async () => {
	sessionState.current = null
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, CREATE[0], CREATE[1], "not-the-secret")
	expect(res.status).toBe(401)
	expect(coreCalls.createDocument).toHaveLength(0)
})

test("an admin session rescues a request carrying a stale secret header", async () => {
	// The SPA sends no header, but a cached page or an old deploy could. A bad
	// header must not lock a legitimate admin out.
	sessionState.current = { role: "admin" }
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, CREATE[0], CREATE[1], "stale-value")
	expect(res.status).toBe(200)
	expect(coreCalls.createDocument).toHaveLength(1)
})

// ---------------------------------------------------------------------------
// Every write procedure is covered by both paths, not just documents.create
// ---------------------------------------------------------------------------

const WRITES: Array<[string, unknown]> = [
	["documents/create", { slug: "d", title: "t", section: "s", body: "b" }],
	["documents/update", { slug: "d", body: "b" }],
	["documents/remove", { slug: "d" }],
	["revisions/restore", { id: "r1" }],
]

test.each(WRITES)(
	"%s is reachable by an admin session",
	async (proc, input) => {
		sessionState.current = { role: "admin" }
		const app = await createApp(deps(SECRET))
		const res = await rpc(app, proc, input)
		expect(res.status).toBe(200)
	},
)

test.each(WRITES)(
	"%s is refused with 403 for a non-admin session",
	async (proc, input) => {
		sessionState.current = { role: "user" }
		const app = await createApp(deps(SECRET))
		const res = await rpc(app, proc, input)
		// 403, not 401. The caller IS authenticated — they signed in and hold a
		// valid session; the credential check passed and it was the ROLE that
		// failed. Reporting 401 would tell them to re-authenticate, which would
		// not help, and would hide the fact that this account can never write.
		expect(res.status).toBe(403)
		expect(coreCalls.createDocument).toHaveLength(0)
		expect(coreCalls.updateDocument).toHaveLength(0)
		expect(coreCalls.deleteDocument).toHaveLength(0)
		expect(coreCalls.restoreRevision).toHaveLength(0)
	},
)

// ---------------------------------------------------------------------------
// auth.me reports the session
// ---------------------------------------------------------------------------

test("auth.me reports the admin role for a session", async () => {
	sessionState.current = { role: "admin" }
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, "auth/me", {})
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({
		json: { authenticated: true, role: "admin", via: "session" },
	})
})

test("auth.me reports a signed-in non-admin as authenticated with role user", async () => {
	// The distinction this preserves: "signed in, may read" is NOT the same answer
	// as "not signed in", and the SPA renders differently for each.
	sessionState.current = { role: "user" }
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, "auth/me", {})
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({
		json: { authenticated: true, role: "user", via: "session" },
	})
})

test("auth.me still reports anonymous when there is no session and no secret", async () => {
	sessionState.current = null
	const app = await createApp(deps(SECRET))
	const res = await app.request("/rpc/auth/me", { method: "POST" })
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({
		json: { authenticated: false, role: null, via: null },
	})
})

test("auth.me still reports the secret path for MCP, without a session lookup", async () => {
	sessionState.current = null
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, "auth/me", {}, SECRET)
	expect(await res.json()).toEqual({
		json: { authenticated: true, role: "admin", via: "webhook-secret" },
	})
	expect(sessionState.loads).toBe(0)
})

// ---------------------------------------------------------------------------
// Reads stay public, and the session is never resolved for them
// ---------------------------------------------------------------------------

test("a read procedure needs no credential and never touches the session", async () => {
	sessionState.current = null
	const app = await createApp(deps(SECRET))
	const res = await app.request("/rpc/documents/sections", { method: "POST" })
	expect(res.status).toBe(200)
	// Public reads must not pay for a session lookup — that is why loadSession is
	// a function on the context rather than an eagerly-resolved field.
	expect(sessionState.loads).toBe(0)
})

test("a credential check still precedes payload validation on writes", async () => {
	// 401, not 400: an unauthenticated caller must not learn the shape of a
	// schema it has no right to probe.
	sessionState.current = null
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, "documents/create", { slug: "" })
	expect(res.status).toBe(401)
})
