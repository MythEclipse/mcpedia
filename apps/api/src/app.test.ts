import type { Hono } from "hono"
import { beforeEach, expect, test, vi } from "vitest"
import type { ApiDeps } from "../src/app"
import { createApp } from "../src/app"
import { DASHBOARD_HTML } from "../src/dashboard"

// -------------------------------------------------------------------
// A fake queue that records calls and returns canned counts. Injected into
// createApp so no live Redis/BullMQ is needed.
// -------------------------------------------------------------------
function fakeQueue(counts: Record<string, number>) {
	const base = {
		waiting: counts.waiting ?? 0,
		active: counts.active ?? 0,
		completed: counts.completed ?? 0,
		failed: counts.failed ?? 0,
		delayed: counts.delayed ?? 0,
	}
	return {
		getWaitingCount: () => Promise.resolve(base.waiting),
		getActiveCount: () => Promise.resolve(base.active),
		getCompletedCount: () => Promise.resolve(base.completed),
		getFailedCount: () => Promise.resolve(base.failed),
		getDelayedCount: () => Promise.resolve(base.delayed),
	}
}

function makeDeps(secret: string, q: ReturnType<typeof fakeQueue>): ApiDeps {
	return { queue: q, webhookSecret: secret }
}

// Mock @mcpedia/queue so the production lazy-import path in createApp(deps=undefined)
// doesn't try to connect to Redis during construction. We never call that path in
// these tests (we always inject deps), but the import may still be pulled by the
// module graph — mock it to be safe.
/**
 * `getAuth` is stubbed because the write gate now RESOLVES A SESSION.
 *
 * The routers ask for the caller's identity in order to stamp the audit trail,
 * which means `loadSession()` runs on every write — including one that arrived
 * with no credential at all, where the gate is about to refuse it anyway.
 * Without this stub, `getAuth()` builds a real better-auth instance, which needs
 * a database connection and a trusted origin, and the lookup rejects. That
 * rejection is NOT an AppError, so it escaped `mapAppErrors` as a genuine 500
 * and every "no secret -> 401" assertion failed with a status that says nothing
 * about authorization.
 *
 * `sessionState` is the single knob: set it to a role to simulate a signed-in
 * caller, leave it null for an anonymous one.
 */
const sessionState = vi.hoisted(() => ({
	current: null as { role: "admin" | "user"; userId?: string } | null,
	loads: 0,
}))

vi.mock("./auth", async () => {
	const actual = await vi.importActual<typeof import("./auth")>("./auth")
	return {
		...actual,
		// `sessionLoader` calls `getSessionForRequest`, NOT `getAuth()` directly —
		// stubbing `getAuth` alone leaves the real lookup running, which builds a
		// real better-auth instance, needs a database, and REJECTS. A rejection is
		// not an AppError, so it escaped the error mapper as a genuine 500 and every
		// "refused -> 401" assertion failed with a status unrelated to authorization.
		getSessionForRequest: async () => {
			sessionState.loads++
			if (!sessionState.current) return null
			return {
				user: {
					id: sessionState.current.userId ?? "u1",
					role: sessionState.current.role,
				},
			}
		},
		isAdminRequest: async () => sessionState.current?.role === "admin",
	}
})

vi.mock("@mcpedia/queue", () => ({
	getQueue: () => fakeQueue({}),
	enqueueFullIndex: async () => ({ id: "real-full" }),
	enqueueIndexDoc: async () => ({ id: "real-doc" }),
	INDEX_QUEUE: "mcpedia-index",
}))

// Mock @mcpedia/core so tRPC CRUD procedures don't hit Postgres.
// Only the functions used by the router are faked; assertions record calls.
// vi.mock() calls are hoisted above every import, so their factories can run
// before this module's body executes. vi.hoisted() moves the shared call log
// ahead of the hoisted factories, otherwise it would be in the TDZ.
/**
 * Call log for the three faked mutating core functions.
 *
 * The recorded arguments are never inspected — every assertion below is
 * `toHaveLength(...)`, i.e. "was core called, and how often" — so they are
 * logged as `unknown[]` rather than typed to a signature the mock does not
 * actually implement.
 */
type CoreCallArgs = unknown[]

const coreCalls = vi.hoisted(() => ({
	createDocument: [] as CoreCallArgs[],
	updateDocument: [] as CoreCallArgs[],
	deleteDocument: [] as CoreCallArgs[],
	// Restores go through the revision router's own composition root, so they need
	// a bucket of their own. Sharing another procedure's bucket would let a
	// restore assertion silently pass on a document write's calls.
	restoreRevision: [] as CoreCallArgs[],
}))
vi.mock("@mcpedia/core", async () => {
	/**
	 * The stub bodies live INSIDE the factory, not beside it.
	 *
	 * `vi.mock` calls are hoisted above every module-level `const`, so a helper
	 * declared next to them is still in its temporal dead zone when the factory
	 * runs — the reference throws `Cannot access 'X' before initialization` and
	 * the whole file collects zero tests. `vi.hoisted` is the supported way to
	 * declare something the factory needs, and `coreCalls` already uses it.
	 */
	const CREATE_DOC = (...args: CoreCallArgs) => {
		coreCalls.createDocument.push(args)
		return Promise.resolve({ slug: "docs/test", title: "Test" })
	}
	const UPDATE_DOC = (...args: CoreCallArgs) => {
		coreCalls.updateDocument.push(args)
		const [slug] = args
		return Promise.resolve({
			slug: typeof slug === "string" ? slug : "docs/test",
			title: "Updated",
		})
	}
	const DELETE_DOC = (...args: CoreCallArgs) => {
		coreCalls.deleteDocument.push(args)
		return Promise.resolve({ deleted: true })
	}
	const RESTORE_REV = (...args: CoreCallArgs) => {
		coreCalls.restoreRevision.push(args)
		return Promise.resolve(null)
	}

	// `asAppError` comes from the REAL module: the error-mapping middleware reads
	// it on every thrown value, and a mock that omits it throws on the property
	// access itself, turning every typed status into a 500.
	const real =
		await vi.importActual<typeof import("@mcpedia/core")>("@mcpedia/core")
	return {
		asAppError: real.asAppError,
		// `requireRole` raises its refusals with these. A mock that omits them
		// makes the property access itself throw — "[vitest] No 'unauthorized'
		// export is defined on the @mcpedia/core mock" — and because that is a
		// plain Error rather than a branded AppError it escapes `mapAppErrors`
		// as a genuine 500. Every "refused -> 401" assertion then failed with a
		// status that says nothing about authorization.
		forbidden: real.forbidden,
		unauthorized: real.unauthorized,
		keywordSearch: () => Promise.resolve([]),
		getDocument: () => Promise.resolve(null),
		getRelated: () => Promise.resolve([]),
		hybridSearch: () => Promise.resolve([]),
		semanticSearch: () => Promise.resolve([]),
		listDocuments: () => Promise.resolve([]),
		listRevisions: () => Promise.resolve([]),
		getRevision: () => Promise.resolve(null),
		createDocument: CREATE_DOC,
		updateDocument: UPDATE_DOC,
		deleteDocument: DELETE_DOC,

		/**
		 * The routers call the COMPOSITION ROOT now, not the legacy wrappers.
		 *
		 * Both entry points are faked and both record into the SAME `coreCalls`
		 * buckets: what these suites assert is that a write did or did not reach
		 * core, not which of core's two doors it came through. Pinning a function
		 * name would make the suite fail on a wiring change that altered nothing
		 * observable.
		 */
		documentUseCases: (actor?: unknown) => ({
			create: (...a: unknown[]) => CREATE_DOC([actor, ...a]),
			update: (...a: unknown[]) => UPDATE_DOC([actor, ...a]),
			remove: (...a: unknown[]) => DELETE_DOC([actor, ...a]),
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
			restore: (...a: unknown[]) => RESTORE_REV([actor, ...a]),
			snapshot: () => Promise.resolve(false),
		}),
		indexingUseCases: () => ({
			indexFile: () => Promise.resolve({ indexed: true, chunks: 0 }),
			runFullIndex: () => Promise.resolve({ indexed: 0, chunks: 0 }),
		}),
	}
})

let SECRET: string
beforeEach(() => {
	SECRET = `test-secret-${Math.random().toString(36).slice(2)}`
	// `coreCalls` is module-scoped (it must be — vi.mock factories are hoisted
	// above the imports and would otherwise capture it in the TDZ), so it
	// accumulates across every test in this file. The CRUD assertions below use
	// ABSOLUTE counts (`toHaveLength(0)`, `toHaveLength(1)`), which were only
	// ever correct because those tests happened to run first. Clearing the log
	// here makes each test's count mean "calls made by this test", so the file
	// stops being order-dependent.
	coreCalls.createDocument.length = 0
	coreCalls.updateDocument.length = 0
	coreCalls.deleteDocument.length = 0
})

test("GET /health returns { ok: true }", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await app.request("/health")
	expect(res.status).toBe(200)
	expect(await res.json()).toEqual({ ok: true })
})

test("GET /metrics emits Prometheus text with all gauge states", async () => {
	const app = await createApp(
		makeDeps(
			SECRET,
			fakeQueue({ waiting: 1, active: 2, completed: 3, failed: 4, delayed: 5 }),
		),
	)
	const res = await app.request("/metrics")
	expect(res.status).toBe(200)
	expect(res.headers.get("Content-Type")).toMatch(/text\/plain/)
	const text = await res.text()
	expect(text).toContain("mcpedia_uptime_seconds")
	expect(text).toContain('mcpedia_queue_jobs{state="waiting"} 1')
	expect(text).toContain('mcpedia_queue_jobs{state="active"} 2')
	expect(text).toContain('mcpedia_queue_jobs{state="completed"} 3')
	expect(text).toContain('mcpedia_queue_jobs{state="failed"} 4')
	expect(text).toContain('mcpedia_queue_jobs{state="delayed"} 5')
})

test("POST /hooks/reindex without secret -> 401", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await app.request("/hooks/reindex", { method: "POST" })
	expect(res.status).toBe(401)
	expect((await res.json()).error).toBe("unauthorized")
})

test("POST /hooks/reindex with correct x-webhook-secret -> 200", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await app.request("/hooks/reindex", {
		method: "POST",
		headers: { "x-webhook-secret": SECRET },
	})
	expect(res.status).toBe(200)
	const body = await res.json()
	expect(body.ok).toBe(true)
	expect(body.kind).toBe("full")
	expect(body.jobId).toBeTruthy()
})

test("POST /hooks/index without slug -> 400", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await app.request("/hooks/index", {
		method: "POST",
		headers: { "x-webhook-secret": SECRET },
	})
	expect(res.status).toBe(400)
})

test("POST /hooks/index with slug + secret -> 200 + relPath", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await app.request("/hooks/index?slug=docs/test", {
		method: "POST",
		headers: { "x-webhook-secret": SECRET },
	})
	expect(res.status).toBe(200)
	const body = await res.json()
	expect(body.ok).toBe(true)
	expect(body.relPath).toBe("docs/test.md")
})

test("POST /hooks/index with wrong secret -> 401", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await app.request("/hooks/index?slug=docs/test", {
		method: "POST",
		headers: { "x-webhook-secret": "WRONG" },
	})
	expect(res.status).toBe(401)
})

test("GET /dashboard returns the self-contained HTML", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await app.request("/dashboard")
	expect(res.status).toBe(200)
	const html = await res.text()
	// The dashboard HTML is a module-level constant — assert the route serves it
	// verbatim and contains the key landmarks.
	expect(html).toContain("MCPedia Dashboard")
	expect(html).toContain("Index Queue (BullMQ)")
	expect(html).toContain(DASHBOARD_HTML.slice(0, 100))
})

// --- CRUD procedures over oRPC (auth-gated) ---

function rpcRequest(
	app: Hono,
	procedure: string,
	input: unknown,
	secret?: string,
) {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	}
	if (secret) headers["x-webhook-secret"] = secret
	// The oRPC RPC wire format wraps the input in a `{ json, meta }` envelope —
	// `meta` carries type information for non-JSON types (Date, BigInt, ...) and
	// is omitted when empty. This is what @orpc/client's RPC link sends, and the
	// handler rejects a bare object as "expected object, received undefined".
	// The procedure is addressed by the path after the /rpc mount point.
	return app.request(`/rpc/${procedure}`, {
		method: "POST",
		headers,
		body: JSON.stringify({ json: input }),
	})
}

/**
 * The origin serves oRPC at /trpc as well as /rpc.
 *
 * This is not a compatibility shim for old clients — there are none. It exists
 * because /etc/caddy/Caddyfile proxies /trpc/* to :4020 and has not been updated
 * yet. Mounting only /rpc would make every edge-proxied RPC call 404 while the
 * origin itself stayed healthy, which is the worst possible failure shape: the
 * health probe passes and the feature is simply gone.
 *
 * Both mounts must reach the SAME procedure and apply the SAME auth gate, so
 * this asserts behaviour through /trpc rather than just a non-404 — a route that
 * merely exists but bypasses the write gate would be worse than the 404.
 */
test("the /trpc mount reaches the same procedures under the same write gate", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))

	const body = JSON.stringify({
		json: { slug: "docs/t", title: "T", section: "docs", body: "# x" },
	})

	const denied = await app.request("/trpc/documents/create", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body,
	})
	expect(denied.status).toBe(401)
	expect(coreCalls.createDocument).toHaveLength(0)

	const allowed = await app.request("/trpc/documents/create", {
		method: "POST",
		headers: { "content-type": "application/json", "x-webhook-secret": SECRET },
		body,
	})
	expect(allowed.status).toBe(200)
	expect(coreCalls.createDocument).toHaveLength(1)
})

test("the /trpc mount does not leak state into the /rpc mount", async () => {
	// Both mounts share ONE RPCHandler instance. If a handler mutated the router's
	// context or a module-level buffer, a call through one path would change what
	// the other path returns.
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const body = JSON.stringify({
		json: { slug: "docs/t", title: "T", section: "docs", body: "# x" },
	})
	const post = (path: string) =>
		app.request(path, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-webhook-secret": SECRET,
			},
			body,
		})

	const viaTrpc = await post("/trpc/documents/create")
	expect(viaTrpc.status).toBe(200)

	const viaRpc = await post("/rpc/documents/create")
	expect(viaRpc.status).toBe(200)
	// Two requests in, exactly two calls out — the shared handler neither dropped
	// nor duplicated one.
	expect(coreCalls.createDocument).toHaveLength(2)
})

test("oRPC documents.create without secret -> 401 + does not reach core", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await rpcRequest(app, "documents/create", {
		slug: "docs/test",
		title: "Test",
		section: "docs",
		body: "# Hi",
	})
	// oRPC's ORPCError carries a real status, so the gate now answers 401 where
	// tRPC's bare middleware Error surfaced as 500. Only the status changed: the
	// request is still refused and core is still never reached.
	expect(res.status).toBe(401)
	expect(coreCalls.createDocument).toHaveLength(0)
})

test("oRPC documents.create with secret -> 200 + calls core", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await rpcRequest(
		app,
		"documents/create",
		{
			slug: "docs/test",
			title: "Test",
			section: "docs",
			body: "# Hi",
		},
		SECRET,
	)
	expect(res.status).toBe(200)
	expect(coreCalls.createDocument).toHaveLength(1)
})

test("oRPC documents.update with secret -> 200 + calls core", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await rpcRequest(
		app,
		"documents/update",
		{
			slug: "docs/test",
			body: "# Updated",
		},
		SECRET,
	)
	expect(res.status).toBe(200)
	expect(coreCalls.updateDocument).toHaveLength(1)
})

test("oRPC documents.remove without secret -> 401 + does not reach core", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await rpcRequest(app, "documents/remove", {
		slug: "docs/test",
	})
	// Same status-code correction as documents.create above; the fail-closed
	// behaviour itself is unchanged.
	expect(res.status).toBe(401)
	expect(coreCalls.deleteDocument).toHaveLength(0)
})

test("oRPC documents.remove with secret -> 200 + calls core", async () => {
	const app = await createApp(makeDeps(SECRET, fakeQueue({})))
	const res = await rpcRequest(
		app,
		"documents/remove",
		{
			slug: "docs/test",
		},
		SECRET,
	)
	expect(res.status).toBe(200)
	expect(coreCalls.deleteDocument).toHaveLength(1)
})
