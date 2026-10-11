import { serve } from "@hono/node-server"
import { Hono } from "hono"
import type { Context as HonoContext } from "hono"
import { createHmac, timingSafeEqual } from "node:crypto"
import { RPCHandler } from "@orpc/server/fetch"
import { appRouter } from "./presentation/routers"
import type { ApiContext } from "./presentation/context"
import { WEBHOOK_SECRET } from "@mcpedia/config"
import { db } from "@mcpedia/db"
import { DASHBOARD_HTML } from "./dashboard"
import { safeSecretEqual } from "./secret"

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
}

/** Build the Hono application. Pure construction — no process exit, no side
 * side effects. Tests inject fakes via `deps`. Production callers may omit it,
 * in which case the real queue + configured WEBHOOK_SECRET are used. */
export async function createApp(deps?: ApiDeps): Promise<Hono> {
	const d = deps ?? (await realDeps())
	const app = new Hono()

	app.get("/health", (c) => c.json({ ok: true }))

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
		return c.text(lines.join("\n") + "\n", 200, {
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
		if (ghSig && ghSig.startsWith("sha256=")) {
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

	// --- Phase 7: observability dashboard (public) ---
	app.get("/dashboard", (c) => c.html(DASHBOARD_HTML))

	// oRPC RPC surface. Read-only procedures are public; the four state-changing
	// ones are gated by x-webhook-secret in the presentation layer's
	// requireWriteAuth middleware (apps/api/src/presentation/middleware.ts).
	//
	// The handler is built once per app and reused: constructing RPCHandler walks
	// the router to build a path matcher, so building it per request would redo
	// that work on every call.
	const rpcHandler = new RPCHandler(appRouter)

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
				context: {
					db, // real Postgres connection (read procedures use it via @mcpedia/db).
					request,
					webhookSecret: request.headers.get("x-webhook-secret") ?? undefined,
					expectedSecret: d.webhookSecret,
				} satisfies ApiContext,
			})
			return response
		}
	}

	app.all("/rpc/*", mountRpc("/rpc"))
	app.all("/trpc/*", mountRpc("/trpc"))

	return app
}

/** Resolve production deps (real queue + configured secret). */
async function realDeps(): Promise<ApiDeps> {
	const { getQueue } = await import("@mcpedia/queue")
	return { queue: getQueue(), webhookSecret: WEBHOOK_SECRET }
}

const port = Number(process.env.API_PORT ?? 4020)

/** Fail-fast production entry: refuses to start with no webhook secret. */
export async function start(opts?: { port?: number }): Promise<void> {
	if (!WEBHOOK_SECRET) {
		throw new Error(
			"WEBHOOK_SECRET is not set — /hooks/* would be open. Set it (see .env.example) before starting the API.",
		)
	}
	const app = await createApp()
	serve({ fetch: app.fetch, port: opts?.port ?? port }, (info) => {
		console.log(`MCPedia API listening on http://localhost:${info.port}`)
	})
}
