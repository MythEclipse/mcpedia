import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { createApp } from "../app"
import { createHttpMiddleware, REQUEST_ID_HEADER } from "./http-middleware"

/**
 * THE MIDDLEWARE CHAIN MUST NOT BREAK A BARE-Response HANDLER.
 *
 * ## THE BUG THIS PINS
 *
 * Mounting cross-cutting middleware (starting with `requestId`) turned an
 * unknown RPC procedure from a 404 into a 500 with "Context is not finalized".
 *
 * Hono's dispatcher requires a handler to produce its response THROUGH the
 * context (`c.res`, `c.json(...)`). oRPC's `RPCHandler` returns a bare
 * Web-standard `Response` and never touches the context. With no middleware
 * mounted Hono accepts a bare Response. `requestId` calls `c.set(...)`, which
 * REPLACES the context object, so a bare Response produced downstream belongs to
 * the original context and the composed one never finalizes.
 *
 * Two distinct failure modes existed, and BOTH are asserted here:
 *
 *   - returning the bare Response    -> 500 "Context is not finalized"
 *   - returning `undefined` blindly  -> 200 with an EMPTY body, because
 *     `c.res`'s default is a fresh 200. A silent wrong answer is more dangerous
 *     than the 500, and is invisible without an explicit assertion.
 *
 * `app.ts`'s `adoptResponse` handles both: pass `undefined` through so Hono
 * runs its own 404, and adopt a real Response so the chain's headers survive.
 *
 * ## WHY THESE DRIVE THE REAL createApp
 *
 * An earlier version of this file re-implemented the mount inline. Its mirror
 * diverged from the real code — it returned `undefined` where the real app
 * returned an adopted response — and so reported failures the real application
 * did not have. The tests were measuring the copy rather than the thing.
 * Anything that can drift from production must not be the thing under test.
 */

const SECRET = "s3cret-for-tests"

const deps = {
	queue: {
		getWaitingCount: async () => 0,
		getActiveCount: async () => 0,
		getCompletedCount: async () => 0,
		getFailedCount: async () => 0,
		getDelayedCount: async () => 0,
	},
	webhookSecret: SECRET,
}

describe("cross-cutting middleware does not break the oRPC mounts", () => {
	it("still returns 404 — not 500 — for an unknown RPC procedure", async () => {
		const app = await createApp(deps)
		const res = await app.request("/rpc/no/such/procedure", { method: "POST" })
		expect(res.status).toBe(404)
	})

	it("still returns 404 for an unknown path under the REST mount", async () => {
		const app = await createApp(deps)
		const res = await app.request("/api/no/such/procedure", { method: "POST" })
		expect(res.status).toBe(404)
	})

	it("serves a real procedure with the middleware chain mounted", async () => {
		const app = await createApp(deps)
		const res = await app.request("/rpc/health/ping", { method: "POST" })
		expect(res.status).toBe(200)
	})

	it("keeps the request id header on an oRPC response", async () => {
		// The regression's other half: adopting the Response must not drop what
		// the middleware chain already wrote onto the context.
		const app = await createApp(deps)
		const res = await app.request("/rpc/health/ping", { method: "POST" })
		expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy()
	})

	it("keeps the security headers on an oRPC response", async () => {
		const app = await createApp(deps)
		const res = await app.request("/rpc/health/ping", { method: "POST" })
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
	})

	it("keeps the security headers on a 404 too", async () => {
		const app = await createApp(deps)
		const res = await app.request("/rpc/no/such/procedure", { method: "POST" })
		expect(res.status).toBe(404)
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
	})
})

describe("the middleware chain itself", () => {
	const chain = (
		allowedOrigins: readonly string[] = ["https://mcpedia.example.com"],
	) => createHttpMiddleware({ allowedOrigins })

	const bare = () => {
		const app = new Hono()
		for (const m of chain()) app.use(m)
		app.get("/x", (c) => c.text("ok"))
		app.post("/rpc/x", (c) => c.text("handler"))
		return app
	}

	it("attaches a request id header to every response", async () => {
		const res = await bare().request("/x")
		expect(res.headers.get(REQUEST_ID_HEADER)).toBeTruthy()
	})

	it("answers a CORS preflight before the route runs", async () => {
		const res = await bare().request("/rpc/x", {
			method: "OPTIONS",
			headers: {
				Origin: "https://mcpedia.example.com",
				"Access-Control-Request-Method": "POST",
			},
		})
		expect(res.status).toBe(204)
		expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true")
	})

	it("does not echo an unlisted origin while allowing credentials", async () => {
		// The dangerous combination is ACAO echoing a foreign origin WHILE
		// allowing credentials — that hands a third-party site a usable session.
		const res = await bare().request("/x", {
			headers: { Origin: "https://evil.example" },
		})
		expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe(
			"https://evil.example",
		)
	})

	it("sets the security headers it claims to", async () => {
		const res = await bare().request("/x")
		expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff")
		expect(res.headers.get("Referrer-Policy")).toBe("no-referrer")
		expect(res.headers.get("X-Powered-By")).toBeNull()
	})

	it("does not let an empty allowed-origins list become a wildcard", async () => {
		// allowedOrigins: [] is the same-origin default. If it degraded to "*"
		// alongside credentials:true, any site could make authenticated calls.
		const app = new Hono()
		for (const m of chain([])) app.use(m)
		app.get("/x", (c) => c.text("ok"))
		const res = await app.request("/x", {
			headers: { Origin: "https://anything.example" },
		})
		expect(res.headers.get("Access-Control-Allow-Origin")).not.toBe("*")
	})
})
