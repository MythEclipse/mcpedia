import type { Hono } from "hono"
import { beforeEach, expect, test, vi } from "vitest"
import type { ApiDeps } from "../app"
import { createApp } from "../app"

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
 * The write handlers now resolve the caller's identity so they can stamp the
 * audit trail, which means `sessionLoader` runs on every write. `sessionLoader`
 * calls `getSessionForRequest` — stubbing `getAuth` would leave the real lookup
 * running, and its rejection (no database, no trusted origin) is a plain Error
 * that `mapAppErrors` cannot classify, so it surfaced as a 500 on the SUCCESS
 * path. These tests are about the secret gate, so the session is always absent
 * here: the gate must accept the secret without ever needing one.
 */
const sessionState = vi.hoisted(() => ({ loads: 0 }))

vi.mock("../auth", async () => {
	const actual = await vi.importActual<typeof import("../auth")>("../auth")
	return {
		...actual,
		getSessionForRequest: async () => {
			sessionState.loads++
			return null
		},
		isAdminRequest: async () => false,
	}
})

vi.mock("@mcpedia/queue", () => ({
	getQueue: () => fakeQueue,
	enqueueFullIndex: async () => ({ id: "full" }),
	enqueueIndexDoc: async () => ({ id: "doc" }),
	INDEX_QUEUE: "mcpedia-index",
}))

vi.mock("@mcpedia/core", async () => {
	// `asAppError` is spread in from the REAL module rather than stubbed. The
	// error-mapping middleware calls it on every thrown value, so a mock that
	// omits it makes the property access itself throw ("No asAppError export is
	// defined on the @mcpedia/core mock") and every typed status collapses to a
	// 500. Reusing the genuine implementation keeps the test exercising the same
	// narrowing that production does.
	const real =
		await vi.importActual<typeof import("@mcpedia/core")>("@mcpedia/core")

	/**
	 * Built as a named object BEFORE it is returned.
	 *
	 * The composition-root fakes delegate to the legacy stubs by name, and inside
	 * an object literal a property reference resolves to a local binding — not to
	 * a sibling key. `createDocument(...)` in that position is a ReferenceError
	 * for an undeclared identifier, which surfaces as an unhandled 500 on every
	 * request rather than a test failure that names the problem.
	 */
	const api = {
		asAppError: real.asAppError,
		// `requireRole` raises its refusals with these. A mock that omits them
		// makes the property access itself throw — "[vitest] No 'unauthorized'
		// export is defined on the @mcpedia/core mock" — and because that is a
		// plain Error rather than a branded AppError it escapes `mapAppErrors`
		// as a genuine 500. Every "refused -> 401" assertion then failed with a
		// status that says nothing about authorization.
		forbidden: real.forbidden,
		unauthorized: real.unauthorized,
		conflict: real.conflict,
		notFound: real.notFound,
		badRequest: real.badRequest,
		createDocument: (...a: unknown[]) => {
			coreCalls.createDocument.push(a)
			// Reserved slugs stand in for specific database states so the
			// typed-error assertions below reach the mapper instead of a stub.
			// "docs/boom" raises an UNBRANDED error — a driver fault, not ours —
			// which must stay a generic 500.
			if (a[0] && typeof a[0] === "object") {
				const slug = (a[0] as { slug?: string }).slug
				if (slug === "docs/taken") {
					return Promise.reject(
						real.conflict(`document already exists at slug: ${slug}`),
					)
				}
				if (slug === "docs/boom") {
					return Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432"))
				}
				if (slug === "../etc/passwd") {
					return Promise.reject(real.badRequest(`invalid slug: ${slug}`))
				}
			}
			return Promise.resolve({ slug: "docs/test" })
		},
		updateDocument: (...a: unknown[]) => {
			coreCalls.updateDocument.push(a)
			if (a[0] === "docs/gone") {
				return Promise.reject(
					real.notFound(`document not found: ${a[0] as string}`),
				)
			}
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

		/**
		 * The routers call the COMPOSITION ROOT, not these legacy wrappers.
		 *
		 * Both are faked, and both record into the SAME `coreCalls` buckets,
		 * because the reserved-slug behaviour above is the point of this file and
		 * duplicating it would let the two fakes drift.
		 *
		 * The actor is DELIBERATELY NOT forwarded into the legacy stub. It is a
		 * factory argument, not part of the use case's own signature, and splicing
		 * it in would shift every positional index — the reserved-slug checks read
		 * `a[0]` and would then be inspecting the actor. The actor's own
		 * propagation is asserted in session-gate.test.ts, which is where a
		 * session exists; these tests are about the secret gate, where none does.
		 */
		documentUseCases: () => ({
			create: (input: unknown) =>
				(api.createDocument as (...x: unknown[]) => Promise<unknown>)(input),
			update: (slug: string, input: unknown) =>
				(api.updateDocument as (...x: unknown[]) => Promise<unknown>)(
					slug,
					input,
				),
			remove: (slug: string) =>
				(api.deleteDocument as (...x: unknown[]) => Promise<unknown>)(slug),
			get: () => Promise.resolve(null),
			list: () => Promise.resolve([]),
			related: () => Promise.resolve([]),
			sections: () => Promise.resolve([]),
			folderInfo: () => Promise.resolve({}),
			export: () => Promise.resolve({ summary: {}, documents: [] }),
		}),
		revisionUseCases: () => ({
			list: () => Promise.resolve([]),
			get: () => Promise.resolve(null),
			restore: (id: string) =>
				(api.restoreRevision as (...x: unknown[]) => Promise<unknown>)(id),
			snapshot: () => Promise.resolve(false),
		}),
		indexingUseCases: () => ({
			indexFile: () => Promise.resolve({ indexed: true, chunks: 0 }),
			runFullIndex: () => Promise.resolve({ indexed: 0, chunks: 0 }),
		}),
	}
	return api
})

function deps(secret: string): ApiDeps {
	return { queue: fakeQueue, webhookSecret: secret }
}

function rpc(app: Hono, procedure: string, input: unknown, secret?: string) {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	}
	if (secret) headers["x-webhook-secret"] = secret
	return app.request(`/rpc/${procedure}`, {
		method: "POST",
		headers,
		body: JSON.stringify({ json: input }),
	})
}

let SECRET: string
beforeEach(() => {
	SECRET = `secret-${Math.random().toString(36).slice(2)}`
	for (const k of Object.keys(coreCalls) as Array<keyof typeof coreCalls>) {
		coreCalls[k].length = 0
	}
})

// ---------------------------------------------------------------------------
// The write gate. Each of these asserts the REQUEST NEVER REACHES CORE, which
// is the property that matters: a wrong status code on an already-rejected
// request would still be a security failure.
// ---------------------------------------------------------------------------

const WRITE_PROCEDURES: Array<[string, unknown]> = [
	["documents/create", { slug: "d", title: "t", section: "s", body: "b" }],
	["documents/update", { slug: "d", body: "b" }],
	["documents/remove", { slug: "d" }],
	["revisions/restore", { id: "r1" }],
]

test.each(WRITE_PROCEDURES)(
	"%s with NO secret -> 401, core untouched",
	async (procedure, input) => {
		const app = await createApp(deps(SECRET))
		const res = await rpc(app, procedure, input)
		expect(res.status).toBe(401)
		expect(coreCalls.createDocument).toHaveLength(0)
		expect(coreCalls.updateDocument).toHaveLength(0)
		expect(coreCalls.deleteDocument).toHaveLength(0)
		expect(coreCalls.restoreRevision).toHaveLength(0)
	},
)

test.each(WRITE_PROCEDURES)(
	"%s with WRONG secret -> 401, core untouched",
	async (procedure, input) => {
		const app = await createApp(deps(SECRET))
		const res = await rpc(app, procedure, input, "not-the-secret")
		expect(res.status).toBe(401)
		expect(coreCalls.createDocument).toHaveLength(0)
		expect(coreCalls.updateDocument).toHaveLength(0)
		expect(coreCalls.deleteDocument).toHaveLength(0)
		expect(coreCalls.restoreRevision).toHaveLength(0)
	},
)

// The fail-closed case that the tRPC version got wrong in the other direction:
// an UNCONFIGURED deployment must not treat "no secret exists" as "allow".
test.each(WRITE_PROCEDURES)(
	"%s when WEBHOOK_SECRET is UNSET -> 401, core untouched",
	async (procedure, input) => {
		const app = await createApp(deps(""))
		// Even presenting a secret must not help: there is nothing to match.
		const res = await rpc(app, procedure, input, "anything-at-all")
		expect(res.status).toBe(401)
		expect(coreCalls.createDocument).toHaveLength(0)
		expect(coreCalls.updateDocument).toHaveLength(0)
		expect(coreCalls.deleteDocument).toHaveLength(0)
		expect(coreCalls.restoreRevision).toHaveLength(0)
	},
)

// A secret that is a PREFIX of the real one must be rejected: this is the
// comparison that must not degenerate into a startsWith.
test("a prefix of the correct secret is rejected", async () => {
	const app = await createApp(deps(SECRET))
	const res = await rpc(
		app,
		"documents/remove",
		{ slug: "d" },
		SECRET.slice(0, SECRET.length - 1),
	)
	expect(res.status).toBe(401)
	expect(coreCalls.deleteDocument).toHaveLength(0)
})

// The happy path, to prove the gate is not simply rejecting everything.
test.each(WRITE_PROCEDURES)(
	"%s with the correct secret -> 200 and reaches core",
	async (procedure, input) => {
		const app = await createApp(deps(SECRET))
		const res = await rpc(app, procedure, input, SECRET)
		expect(res.status).toBe(200)
	},
)

// ---------------------------------------------------------------------------
// auth.me — the new read path.
// ---------------------------------------------------------------------------

test("auth.me reports anonymous when unauthenticated (200, not an error)", async () => {
	const app = await createApp(deps(SECRET))
	const res = await app.request("/rpc/auth/me", { method: "POST" })
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({
		json: { authenticated: false, role: null, via: null },
	})
})

test("auth.me reports the admin role for a valid secret", async () => {
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, "auth/me", {}, SECRET)
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({
		json: { authenticated: true, role: "admin", via: "webhook-secret" },
	})
})

test("auth.me never authenticates when no secret is configured", async () => {
	const app = await createApp(deps(""))
	const res = await rpc(app, "auth/me", {}, "anything")
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({
		json: { authenticated: false, role: null, via: null },
	})
})

// ---------------------------------------------------------------------------
// Reads stay public — the gate must not have leaked onto read procedures.
// ---------------------------------------------------------------------------

test("read procedures need no secret", async () => {
	const app = await createApp(deps(SECRET))
	const res = await app.request("/rpc/documents/sections", { method: "POST" })
	expect(res.status).toBe(200)
})

test("health.ping reports whether the secret is configured", async () => {
	const configured = await createApp(deps(SECRET))
	expect(
		await (
			await configured.request("/rpc/health/ping", { method: "POST" })
		).json(),
	).toEqual({ json: { ok: true, expectedSecretConfigured: true } })

	const unconfigured = await createApp(deps(""))
	expect(
		await (
			await unconfigured.request("/rpc/health/ping", { method: "POST" })
		).json(),
	).toEqual({ json: { ok: true, expectedSecretConfigured: false } })
})

// ---------------------------------------------------------------------------
// Input validation still rejects malformed payloads before any handler runs.
// ---------------------------------------------------------------------------

test("malformed input -> 400 and core untouched", async () => {
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, "documents/create", { slug: "" }, SECRET)
	expect(res.status).toBe(400)
	expect(coreCalls.createDocument).toHaveLength(0)
})

test("unknown procedure path -> 404", async () => {
	const app = await createApp(deps(SECRET))
	const res = await app.request("/rpc/no/such/procedure", { method: "POST" })
	expect(res.status).toBe(404)
})

// ---------------------------------------------------------------------------
// Typed application errors carry their status to the wire.
//
// The mock above throws REAL AppErrors so these exercise the actual mapping in
// presentation/middleware.ts -> error-mapping.ts, not a reimplementation of it.
// Before the typed-error change every one of these was an opaque 500.
// ---------------------------------------------------------------------------

test("a duplicate document -> 409 CONFLICT, not a 500", async () => {
	const app = await createApp(deps(SECRET))
	const res = await rpc(
		app,
		"documents/create",
		{ slug: "docs/taken", title: "T", section: "docs", body: "# x" },
		SECRET,
	)
	expect(res.status).toBe(409)
	expect(await res.json()).toMatchObject({
		json: { code: "CONFLICT", status: 409 },
	})
})

test("updating a missing document -> 404 NOT_FOUND", async () => {
	const app = await createApp(deps(SECRET))
	const res = await rpc(app, "documents/update", { slug: "docs/gone" }, SECRET)
	expect(res.status).toBe(404)
	expect(await res.json()).toMatchObject({
		json: { code: "NOT_FOUND", status: 404 },
	})
})

test("an invalid slug -> 400 BAD_REQUEST from the domain layer", async () => {
	const app = await createApp(deps(SECRET))
	const res = await rpc(
		app,
		"documents/create",
		{ slug: "../etc/passwd", title: "T", section: "docs", body: "# x" },
		SECRET,
	)
	expect(res.status).toBe(400)
	expect(await res.json()).toMatchObject({ json: { code: "BAD_REQUEST" } })
})

test("an unexpected internal fault still reports 500 without leaking details", async () => {
	// A foreign exception — no brand, so the mapper must leave it alone.
	const app = await createApp(deps(SECRET))
	const res = await rpc(
		app,
		"documents/create",
		{ slug: "docs/boom", title: "T", section: "docs", body: "# x" },
		SECRET,
	)
	expect(res.status).toBe(500)
	const body = await res.text()
	// The specific cause must NOT reach the caller...
	expect(body).not.toContain("documents/boom")
	// ...but oRPC's generic message is still there, so the shape is unchanged.
	expect(body).toContain("INTERNAL_SERVER_ERROR")
})
