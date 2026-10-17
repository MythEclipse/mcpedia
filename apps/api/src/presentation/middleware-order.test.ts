/**
 * Middleware ORDER, verified rather than assumed.
 *
 * The write gate is attached BEFORE `mapAppErrors`, and the doc comment in
 * routers/document.ts claims the runtime order is
 * `requireWriteAuthOrSession -> zod -> mapAppErrors -> handler`. This test is
 * what makes that claim checkable: the alternative is a refactor that reorders
 * two `.use()` calls and silently changes which layer sees a thrown AppError.
 */

import { AppError } from "@mcpedia/core"
import { ORPCError } from "@orpc/client"
import { os } from "@orpc/server"
import { RPCHandler } from "@orpc/server/fetch"
import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { z } from "zod"

/** Records the order the chain ran in. */
const trace: string[] = []

const gate = os.middleware(async ({ next }) => {
	trace.push("gate:before")
	try {
		return await next()
	} finally {
		trace.push("gate:after")
	}
})

const mapper = os.middleware(async ({ next }) => {
	trace.push("mapAppErrors:before")
	try {
		return await next()
	} catch (err) {
		// The gate's throw lands here only if the mapper WRAPS it.
		trace.push(`mapAppErrors:caught:${(err as AppError).code ?? "?"}`)
		throw err
	} finally {
		trace.push("mapAppErrors:after")
	}
})

const router = os.router({
	probe: os
		.use(gate)
		.use(mapper)
		.handler(() => {
			trace.push("handler")
			return "ok"
		}),
})

const throwing = os.router({
	probe: os
		.use(gate)
		.use(mapper)
		.handler(() => {
			throw new AppError("FORBIDDEN", "insufficient role")
		}),
})

/**
 * Issue the RPC call the way the SPA does.
 *
 * A bare `app.request("/rpc/probe")` is a GET, which oRPC answers with 405 before
 * any middleware runs — the trace comes back empty and every assertion fails for a
 * reason that has nothing to do with middleware order.
 */
async function post(target: Parameters<typeof mount>[0]) {
	const app = mount(target)
	return app.request("/rpc/probe", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ json: null }),
	})
}

/** Wrap a router in a Hono app the way app.ts does, so `handle` exists. */
function mount(target: Parameters<typeof wrap>[0]) {
	const app = new Hono()
	app.all("/rpc/*", async (c) => {
		const { response } = await wrap(target).handle(c.req.raw, {
			// `prefix` is REQUIRED, not optional: without it the mount point is
			// read as a procedure name and every call 404s. app.ts passes it for
			// the same reason.
			prefix: "/rpc",
			context: {},
		})
		return response ?? new Response("no match", { status: 404 })
	})
	return app
}

/**
 * oRPC exposes `.handle` on a HANDLER, not on a bare router.
 *
 * Built from `@orpc/server/fetch` — the same subpath app.ts imports. Reaching for
 * `@orpc/server` instead compiles but throws at call time, which is exactly the
 * kind of mismatch this file exists to rule out.
 */
const wrap = (r: unknown) => new RPCHandler(r as never)

describe("oRPC middleware order", () => {
	it("runs the chain gate -> mapper -> handler", async () => {
		trace.length = 0
		await post(router)
		expect(trace).toEqual([
			"gate:before",
			"mapAppErrors:before",
			"handler",
			"mapAppErrors:after",
			"gate:after",
		])
	})

	it("the mapper catches a throw from a LATER middleware's downstream", async () => {
		trace.length = 0
		await post(throwing)
		// The throw comes from the handler, so the mapper — being closer to it —
		// is what sees it first.
		expect(trace).toContain("mapAppErrors:caught:FORBIDDEN")
	})

	it("a throw from the GATE ITSELF is NOT seen by a mapper attached after it", async () => {
		trace.length = 0
		const gateThrows = os.middleware(async () => {
			throw new AppError("FORBIDDEN", "insufficient role")
		})
		const later = os.router({
			probe: os
				.use(gateThrows)
				.use(mapper)
				.handler(() => "ok"),
		})
		await post(later as never)
		expect(trace).not.toContain("mapAppErrors:caught:FORBIDDEN")
	})
})

/**
 * Does `.input()` validation run BEFORE or AFTER the `.use()` chain?
 *
 * This is the second half of the ordering question, and it is the reason the fix
 * is not simply "put mapAppErrors first". The security requirement is that an
 * unauthenticated caller fails on the CREDENTIAL, never on the payload — a 400
 * for a malformed body would tell an anonymous caller the shape of a schema it
 * has no right to probe.
 */
describe("input validation vs middleware", () => {
	// Thrown as an ORPCError rather than a bare AppError so the wire status is
	// the gate's own 401 and nothing depends on a mapper being attached.
	const gateThrows = os.middleware(async () => {
		throw new ORPCError("UNAUTHORIZED", { message: "no credential" })
	})

	const withGateFirst = os.router({
		probe: os
			.use(gateThrows)
			.input(z.object({ required: z.string() }))
			.handler(({ input }) => `ok:${input.required}`),
	})

	// The same procedure with the input schema declared FIRST. If validation can
	// be made to run ahead of the gate by moving `.input()` up, this is the
	// builder that would leak a 400 to an anonymous caller — and it pins that it
	// does not.
	const withGateAfter = os.router({
		probe: os
			.input(z.object({ required: z.string() }))
			.use(gateThrows)
			.handler(({ input }) => `ok:${input.required}`),
	})

	it("an INVALID payload still reaches the gate when the gate is attached first", async () => {
		// Sending {} violates the schema. If validation ran first we would see a
		// validation error rather than the gate's refusal.
		const app = mount(withGateFirst)
		const res = await app.request("/rpc/probe", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ json: {} }),
		})
		const body = await res.clone().text()
		// 401 = gate ran first (correct). 400 = validation leaked first (wrong).
		expect(`${res.status} ${body}`).toMatch(/^401 /)
	})

	it("MOVING .input() ahead of the gate LEAKS a 400 — which is why the routers do not", async () => {
		const app = mount(withGateAfter)
		const res = await app.request("/rpc/probe", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ json: {} }),
		})
		// This is a 400, NOT a 401. It is asserted as the observed behaviour
		// rather than the desired one on purpose: it is the concrete reason the
		// gate is attached before `.input()` in every write procedure. Flipping
		// that order is not a harmless cleanup — it tells an unauthenticated
		// caller the shape of a schema it has no right to probe, and this test
		// makes that cost visible instead of leaving it in a comment.
		expect(res.status).toBe(400)
	})

	it("a VALID payload with the gate in reach yields the gate's 401, not the handler's 200", async () => {
		const app = mount(withGateAfter)
		const res = await app.request("/rpc/probe", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ json: { required: "x" } }),
		})
		expect(res.status).toBe(401)
	})
})

/**
 * Does an ORPCError carry a status WITHOUT one being passed?
 *
 * The write gate answers `unauthorized(reason)`, which constructs an ORPCError
 * with a code and a message but no explicit status. If oRPC derives 500 for an
 * unset status, every refusal the gate raises is a 500 — which is exactly what
 * the API integration tests reported while each middleware-level test passed.
 */
describe("ORPCError status derivation", () => {
	const router = os.router({
		probe: os.handler(() => {
			throw new ORPCError("UNAUTHORIZED", { message: "no credential" })
		}),
		explicit: os.handler(() => {
			throw new ORPCError("UNAUTHORIZED", {
				message: "no credential",
				status: 401,
			})
		}),
	})

	it("an UNSET status on UNAUTHORIZED becomes 401, not 500", async () => {
		const res = await post(router)
		expect(res.status).toBe(401)
	})

	it("an EXPLICIT 401 stays 401", async () => {
		const res = await mount(router).request("/rpc/explicit", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ json: null }),
		})
		expect(res.status).toBe(401)
	})
})
