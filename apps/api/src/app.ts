import { createHmac, timingSafeEqual } from "node:crypto"
import { serve } from "@hono/node-server"
import { WEBHOOK_SECRET } from "@mcpedia/config"
import { assertStartupEnv, assertWebhookSecret } from "@mcpedia/config/startup"
import { db } from "@mcpedia/db"
import { OpenAPIHandler } from "@orpc/openapi/fetch"
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins"
import { RPCHandler } from "@orpc/server/fetch"
import type { Context as HonoContext } from "hono"
import { Hono } from "hono"
import { getAuth } from "./auth"
import type { ApiContext } from "./presentation/context"
import { createHttpMiddleware } from "./presentation/http-middleware"
import { appRouter } from "./presentation/routers"
import { sessionLoader } from "./presentation/session"
import { safeSecretEqual } from "./secret"

/**
 * Reduce an unknown thrown value to a single safe line of text.
 *
 * Used only by /ready, whose response is read by monitoring. It must not leak a
 * connection string (which carries a password) into a JSON body that a public
 * scraper may log, and it must not echo `String(error)` blindly — for a driver
 * error that includes the DSN.
 */
function describeError(error: unknown): string {
	if (error instanceof Error) return error.message
	return typeof error
}

/**
 * Hand a third-party handler's result back to Hono through the context.
 *
 * ## WHY THIS FUNCTION IS NECESSARY
 *
 * Hono's dispatcher throws "Context is not finalized" when a composed handler
 * chain finishes without any handler having produced a response through the
 * CONTEXT object.
 *
 * oRPC's handlers return a bare Web-standard `Response` and never touch Hono's
 * context. That is fine with no middleware mounted. It breaks the moment
 * `requestId` is added: that middleware calls `c.set("requestId", ...)`, which
 * swaps in a NEW context object. A bare Response produced downstream belongs to
 * the ORIGINAL context, so the composed context — the one the dispatcher
 * inspects — is never marked finalized, and the request throws.
 *
 * ## THE `undefined` CASE, WHICH IS THE SUBTLE HALF
 *
 * `RPCHandler.handle` returns `{ matched: false, response: undefined }` for a
 * path that is not a procedure. That `undefined` must be returned AS-IS so
 * Hono's own not-found handler runs. Assigning `c.res = response` unguarded
 * would not merely be redundant — `c.res` is a getter/setter pair whose default
 * is a fresh 200, so setting it from `undefined` answers an unknown procedure
 * with **200 and an empty body**. A silent wrong answer is worse than the 500
 * this function exists to prevent.
 *
 * ## THE FIX, AND WHY IT IS NOT "RETURN undefined"
 *
 * The no-match signal must NOT be passed through as `undefined`. An
 * `app.all(...)` handler that returns undefined leaves Hono's composed context
 * unfinalized — and because `requestId` already replaced the context object,
 * Hono's dispatcher throws "Context is not finalized" and reports 500. Verified
 * directly: guarding with `if (!response) return undefined` still yields 500.
 *
 * So the not-found response is built HERE, explicitly. That keeps the chain's
 * headers (the 404 goes out with the request id and security headers intact),
 * keeps the status honest, and finalizes the context on every path.
 *
 * ## NO HEADER MERGE, AND WHY
 *
 * An intermediate version copied `c.res.headers` onto the response before
 * adopting, on the theory that the middleware chain's headers would otherwise
 * be lost. Two findings killed it:
 *
 *   1. It was unnecessary. Hono applies the composed context's headers when it
 *      WRITES the response, so the response comes out carrying the request id,
 *      the security headers and the CORS headers regardless. Verified against
 *      the installed Hono, not assumed.
 *
 *   2. It silently did nothing, which is the worse part. `Object.entries()` on a
 *      `Headers` instance returns `[]` — it is not a plain object, so the merge
 *      copied zero headers while appearing to do real work.
 *
 *      If a future change genuinely needs to merge, iterate the Headers directly
 *      (`for (const [k, v] of h)`), never `Object.entries(h)`.
 *
 * Reproduced and pinned in http-middleware.test.ts; the `unknown procedure path
 * -> 404` case in gate.test.ts is the behavioural tripwire that caught this.
 */
function adoptResponse(
	c: HonoContext,
	response: Response | undefined,
): Response {
	// No match. Build the 404 rather than returning undefined: see above. The
	// body is deliberately empty and the status is oRPC's own 404 — a client
	// that guessed a procedure name gets the truth, not a stack trace.
	if (!response) {
		c.res = new Response("Not Found", {
			status: 404,
			headers: { "content-type": "text/plain; charset=UTF-8" },
		})
		return c.res
	}
	c.res = response
	return c.res
}

// ---------------------------------------------------------------------------
// Injectable queue handle. By default we use the real shared BullMQ queue from
// @mcpedia/queue; tests pass a fake queue object. This breaks import-time
// coupling to Redis so the API surface is unit-testable without a broker.
// ---------------------------------------------------------------------------
export interface QueueLike {
	getWaitingCount(): Promise<number>
	getActiveCount(): Promise<number>
	getCompletedCount(): Promise<number>
	getFailedCount(): Promise<number>
	getDelayedCount(): Promise<number>
}

export interface ApiDeps {
	queue: QueueLike
	webhookSecret: string
	/**
	 * Browser origins allowed to send credentialed requests.
	 *
	 * Defaults to same-origin-only (empty) because in the single-image
	 * deployment the SPA is served by this very process, so there is no
	 * cross-origin caller and an empty list is both correct and the safest.
	 * Only the split deploy sets it.
	 */
	allowedOrigins?: readonly string[]
}

/**
 * Build the Hono application. Pure construction — no process exit, no side
 * side effects. Tests inject fakes via `deps`. Production callers may omit it,
 * in which case the real queue + configured WEBHOOK_SECRET are used.
 */
export async function createApp(deps?: ApiDeps): Promise<Hono> {
	const d = deps ?? (await realDeps())
	const app = new Hono()

	// Cross-cutting middleware. Mounted before every route so the request id,
	// the access log, the security headers and the CORS preflight all exist for
	// each of them — including the health endpoints, which are the first thing
	// an orchestrator hits.
	for (const middleware of createHttpMiddleware({
		allowedOrigins: d.allowedOrigins ?? [],
	})) {
		app.use(middleware)
	}

	// Liveness: the PROCESS is up. Deliberately does not touch Postgres or
	// Redis — a liveness probe that fails on a slow database restarts a healthy
	// process, turning a degradation into an outage.
	app.get("/health", (c) => c.json({ ok: true }))
	// Alias for the kana spec's name. Both exist because systemd, the CI
	// deploy script and the Vite proxy each use one of them, and an operator
	// should not have to know which.
	app.get("/healthz", (c) => c.json({ ok: true }))

	// Readiness: the process can actually SERVE traffic. Unlike liveness, this
	// does touch the dependencies, because "up but every request 500s" is the
	// state that must keep traffic away from this instance. A 503 here is the
	// orchestrator's cue to stop routing, not to restart.
	app.get("/ready", async (c) => {
		const checks: Record<string, { ok: boolean; error?: string }> = {}
		try {
			// The cheapest real query: SELECT 1. Proves the pool can hand out a
			// connection and the credentials work, which is what "ready" means.
			await db.execute("SELECT 1")
			checks.db = { ok: true }
		} catch (error) {
			checks.db = { ok: false, error: describeError(error) }
		}
		try {
			await d.queue.getWaitingCount()
			checks.queue = { ok: true }
		} catch (error) {
			checks.queue = { ok: false, error: describeError(error) }
		}
		const ok = Object.values(checks).every((c2) => c2.ok)
		return c.json({ ok, checks }, ok ? 200 : 503)
	})

	// --- Phase 7: Prometheus metrics (public, safe to scrape) ---
	const startedAt = Date.now()
	app.get("/metrics", async (c) => {
		const q = d.queue
		const [waiting, active, completed, failed, delayed] = await Promise.all([
			q.getWaitingCount(),
			q.getActiveCount(),
			q.getCompletedCount(),
			q.getFailedCount(),
			q.getDelayedCount(),
		])
		const lines = [
			"# HELP mcpedia_uptime_seconds seconds since process start",
			"# TYPE mcpedia_uptime_seconds gauge",
			`mcpedia_uptime_seconds ${((Date.now() - startedAt) / 1000).toFixed(1)}`,
			`# HELP mcpedia_queue_jobs queue job counts for "mcpedia-index"`,
			"# TYPE mcpedia_queue_jobs gauge",
			`mcpedia_queue_jobs{state="waiting"} ${waiting}`,
			`mcpedia_queue_jobs{state="active"} ${active}`,
			`mcpedia_queue_jobs{state="completed"} ${completed}`,
			`mcpedia_queue_jobs{state="failed"} ${failed}`,
			`mcpedia_queue_jobs{state="delayed"} ${delayed}`,
		]
		return c.text(`${lines.join("\n")}\n`, 200, {
			"Content-Type": "text/plain; version=0.0.4; charset=utf-8",
		})
	})

	// Shared guard for the git-sync webhooks: require `x-webhook-secret` header
	// to match the configured secret. Reject anything else with 401. Supports
	// GitHub native HMAC (X-Hub-Signature-256) + plain header for manual triggers.
	async function assertWebhookAuth(c: HonoContext): Promise<boolean> {
		if (!d.webhookSecret) return false
		const raw = c.req.raw
		const ghSig = raw.headers.get("x-hub-signature-256")
		if (ghSig?.startsWith("sha256=")) {
			try {
				const body = await raw.text()
				const mac = createHmac("sha256", d.webhookSecret)
					.update(body)
					.digest("hex")
				const expected = `sha256=${mac}`
				return timingSafeEqual(Buffer.from(ghSig), Buffer.from(expected))
			} catch {
				return false
			}
		}
		const provided = raw.headers.get("x-webhook-secret")
		if (provided == null) return false
		return safeSecretEqual(provided, d.webhookSecret)
	}

	// --- Phase 3: Git synchronization hook ---
	// POST /hooks/reindex        -> enqueue a full-corpus reindex (git push webhook)
	// POST /hooks/index?slug=... -> enqueue a single document reindex
	// When a fake queue is injected (tests), these return a synthetic jobId.
	let enqueueFull: (() => Promise<{ id: string }>) | null = null
	let enqueueDoc:
		| ((relPath: string, reason: string) => Promise<{ id: string }>)
		| null = null
	if (deps === undefined) {
		// Production: lazy-import the real queue helpers so the module graph stays
		// clean (no Redis connection at import time if not starting the server).
		const { enqueueFullIndex, enqueueIndexDoc } = await import("@mcpedia/queue")
		enqueueFull = enqueueFullIndex as () => Promise<{ id: string }>
		enqueueDoc = enqueueIndexDoc as (
			relPath: string,
			reason: string,
		) => Promise<{ id: string }>
	}

	app.post("/hooks/reindex", async (c) => {
		if (!(await assertWebhookAuth(c))) {
			return c.json({ ok: false, error: "unauthorized" }, 401)
		}
		if (enqueueFull) {
			const job = await enqueueFull()
			return c.json({ ok: true, jobId: job.id, kind: "full" })
		}
		return c.json({ ok: true, jobId: "fake", kind: "full" })
	})

	app.post("/hooks/index", async (c) => {
		if (!(await assertWebhookAuth(c))) {
			return c.json({ ok: false, error: "unauthorized" }, 401)
		}
		const slug = c.req.query("slug")
		if (!slug)
			return c.json({ ok: false, error: "slug query param required" }, 400)
		const relPath =
			slug.endsWith(".md") || slug.endsWith(".mdx") ? slug : `${slug}.md`
		if (enqueueDoc) {
			const job = await enqueueDoc(relPath, "git-push")
			return c.json({ ok: true, jobId: job.id, kind: "doc", relPath })
		}
		return c.json({ ok: true, jobId: "fake", kind: "doc", relPath })
	})

	// NOTE: there is deliberately NO `/dashboard` page served from this process.
	//
	// There used to be — a self-contained HTML string in ./dashboard with a queue
	// panel, a service panel and an MCP search box. It was public, and it named
	// the product, the protocol and BullMQ on a site whose readers are meant to
	// see a wiki. Worse, its inline script never parsed: the escape helper's map
	// literal had been written with three consecutive `"` characters (a `\"\"\"`
	// sequence that a template literal emits VERBATIM, since a template literal
	// needs no escaping for `"`), so the browser failed at parse time and the
	// queue, metrics and search panels had never populated. A branded page that
	// looks live and does nothing.
	//
	// It is gone rather than restyled. `/dashboard` is a WIKI page now: the SPA
	// owns that URL (`apps/web/src/routes.tsx`, "Site overview" — pages, sections,
	// tags, recent edits, plus the queue strip an operator wants). The Caddyfile
	// in asepharyana/infra no longer proxies /dashboard here, so the catch-all
	// serves the SPA instead. The API answering this path would shadow it.

	// oRPC RPC surface. Read-only procedures are public; the four state-changing
	// ones are gated by x-webhook-secret in the presentation layer's
	// requireWriteAuth middleware (apps/api/src/presentation/middleware.ts).
	//
	// The handler is built once per app and reused: constructing RPCHandler walks
	// the router to build a path matcher, so building it per request would redo
	// that work on every call.
	const rpcHandler = new RPCHandler(appRouter)

	// The OpenAPI handler is built once per app for the same reason: constructing
	// either handler walks the router to build a path matcher.
	//
	// OpenAPIReferencePlugin serves a Swagger UI page at `docsPath` and the spec
	// JSON at `specPath`. Both default to paths that would COLLIDE with real
	// procedures — the UI defaults to "/", i.e. the same path every REST call
	// lives under. So the docs are moved to dedicated, unmistakable paths rather
	// than left at a default: the SPA is served from /, and a docs page
	// answering on the procedure prefix would shadow the API.
	//
	// Whether these are reachable at all is decided at the mount below, not here.
	const openapiHandler = new OpenAPIHandler(appRouter, {
		plugins: [
			new OpenAPIReferencePlugin({
				docsPath: "/_docs",
				specPath: "/_spec.json",
				docsTitle: "mcpedia API",
			}),
		],
	})

	// Mounted at BOTH /rpc and /trpc. /rpc is the kana-stack name and is what the
	// SPA and the future Caddy config will use. /trpc is kept because the
	// production Caddyfile (/etc/caddy/Caddyfile, wiki. block) proxies /trpc/* to
	// :4020 and nothing outside that file has been updated — mounting only /rpc
	// would make every proxied RPC call 404 at the edge while the origin looked
	// perfectly healthy. Both mounts share one handler; the prefix is what maps
	// /rpc/documents/get onto documents.get, so each mount strips its own.
	const mountRpc = (prefix: "/rpc" | "/trpc") => {
		return async (c: HonoContext) => {
			const request = c.req.raw
			const { response } = await rpcHandler.handle(request, {
				// The mount point is not part of any procedure's path. Without
				// this, the prefix is read as a procedure name and every call 404s.
				prefix,
				// The SAME builder the REST mount uses. Two literals would be two
				// definitions of who the caller is.
				context: buildContext(c, d.webhookSecret),
			})
			return adoptResponse(c, response)
		}
	}

	app.all("/rpc/*", mountRpc("/rpc"))
	app.all("/trpc/*", mountRpc("/trpc"))

	// better-auth's own catch-all, at the path the SPA's client is configured
	// with (apps/web/src/lib/auth-config.ts) and that apps/web/vite.config.ts
	// proxies in dev.
	//
	// Until this mount existed, /login posted to a 404, auth.me could only ever
	// report the secret path, and /create was unreachable — documented in three
	// places as a blocker. getAuth() is resolved INSIDE the request, never at
	// module scope, because it throws when BETTER_AUTH_SECRET is unset and this
	// module is imported by tests that run with no .env.
	app.all("/api/auth/*", async (c) => {
		return await getAuth().handler(c.req.raw)
	})

	// OpenAPI/REST surface over the SAME router, mounted at /api.
	//
	// Same handlers, same gates, same validation — OpenAPIHandler is a second
	// protocol adapter over one router, not a second implementation. That is
	// the point: a REST client and the SPA's oRPC client cannot drift, because
	// there is only one set of procedures underneath.
	//
	// `/api/auth/*` is matched earlier and wins, so better-auth is not shadowed.
	//
	// The no-match branch is load-bearing and handled by the SAME helper the RPC
	// mount uses, for the same reason documented on adoptResponse: a handler
	// returning `undefined` leaves Hono's composed context unfinalized once
	// middleware is mounted, and the request surfaces as a 500 instead of a 404.
	app.all("/api/*", async (c) => {
		const { response } = await openapiHandler.handle(c.req.raw, {
			context: buildContext(c, d.webhookSecret),
		})
		return adoptResponse(c, response)
	})

	return app
}

/**
 * Build the per-request oRPC context.
 *
 * Extracted because both protocol adapters need it and a duplicated literal is
 * how the two start disagreeing about who the caller is — the RPC path would
 * keep enforcing a gate the REST path had quietly dropped.
 *
 * `expectedSecret` is threaded from `deps` rather than read from the module
 * scope: tests inject their own, and reading WEBHOOK_SECRET directly here would
 * make the test gate and the production gate different code paths.
 *
 * The session loader is created here, once per request, so the session is
 * verified at most once and never cached across requests.
 */
function buildContext(
	c: HonoContext,
	expectedWebhookSecret: string,
): ApiContext {
	const request = c.req.raw
	return {
		db,
		request,
		webhookSecret: request.headers.get("x-webhook-secret") ?? undefined,
		expectedSecret: expectedWebhookSecret,
		loadSession: sessionLoader(request),
	}
}

/** Resolve production deps (real queue + configured secret). */
async function realDeps(): Promise<ApiDeps> {
	const { getQueue } = await import("@mcpedia/queue")
	return { queue: getQueue(), webhookSecret: WEBHOOK_SECRET }
}

const port = Number(process.env.API_PORT ?? 4020)

/** Fail-fast production entry: refuses to start on an unusable environment. */
export async function start(opts?: { port?: number }): Promise<void> {
	// Validate the WHOLE environment, once, before binding a port. This throws
	// with every problem listed at once — see @mcpedia/config/startup for why
	// that is one call rather than a requireEnv at each use site.
	//
	// The previous check was a single `if (!WEBHOOK_SECRET)`, which fails on the
	// one variable the author happened to think of. A missing DATABASE_URL or
	// BETTER_AUTH_SECRET still bound the port, and the process then reported
	// healthy while every request 500'd.
	assertStartupEnv()

	// The webhook secret's absence is legitimate for a browser-only deployment
	// and fatal for an MCP one — a judgement only the operator can make, so it
	// is stated here rather than inferred.
	assertWebhookSecret()

	const app = await createApp()
	serve({ fetch: app.fetch, port: opts?.port ?? port }, (info) => {
		console.log(`MCPedia API listening on http://localhost:${info.port}`)
	})
}
