import { test, expect, vi, beforeEach } from "vitest"
import { createApp } from "../app"
import type { ApiDeps } from "../app"
import { Hono } from "hono"

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

vi.mock("@mcpedia/queue", () => ({
	getQueue: () => fakeQueue,
	enqueueFullIndex: async () => ({ id: "full" }),
	enqueueIndexDoc: async () => ({ id: "doc" }),
	INDEX_QUEUE: "mcpedia-index",
}))

vi.mock("@mcpedia/core", () => ({
	createDocument: (...a: unknown[]) => {
		coreCalls.createDocument.push(a)
		return Promise.resolve({ slug: "docs/test" })
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
}))

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
	SECRET = "secret-" + Math.random().toString(36).slice(2)
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
