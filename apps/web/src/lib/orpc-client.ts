/**
 * A minimal oRPC RPC-protocol client for the browser, written by hand.
 *
 * ## WHY NOT @orpc/client
 *
 * The obvious move is `createORPCClient(new RPCLink({ url: "/rpc" }))` from
 * @orpc/client. It is not used here for two reasons, both real:
 *
 *  1. It is not a dependency of apps/web. It is a dependency of apps/api, and
 *     under pnpm's isolated linker that means it lives in apps/api/node_modules
 *     and is NOT resolvable from apps/web. Adding it here would mean a lockfile
 *     change and an install, which is outside this task's scope (apps/web only).
 *  2. The SPA does not need the full client. It needs three calls:
 *     auth.me, documents.sections and documents.folderInfo. Those are plain
 *     JSON POSTs, and the whole protocol is small enough to hold in one screen.
 *
 * This is a deliberate, contained reimplementation, not a rewrite of oRPC: it
 * speaks the subset of the RPC protocol this app uses and nothing else.
 *
 * ## THE WIRE FORMAT IS NOT GUESSED
 *
 * Every shape below was read out of the installed @orpc/client 1.15.5 in this
 * repo (apps/api/node_modules/@orpc/client/dist/shared/client.DmANSlrL.mjs),
 * not from memory:
 *
 *  - Request:  POST <base>/<path.join("/")>, body JSON.stringify({ json, meta }),
 *              where `meta` is omitted when empty (line ~392: `const meta =
 *              meta_.length === 0 ? void 0 : meta_`). `toHttpPath` is
 *              `"/" + path.map(encodeURIComponent).join("/")` (line 279).
 *  - Response: the body is `{ json, meta }`; the handler returns
 *              `jsonSerializer.deserialize(data.json, data.meta ?? [])`
 *              (line 430). `meta` is therefore optional on the way back.
 *  - Errors:   a failed call answers with the SAME `{ json }` wrapper — the
 *              server's encodeError is `body: serializer.serialize(error.toJSON())`
 *              (@orpc/server dist/shared/server.*.mjs) — so the envelope must be
 *              unwrapped BEFORE it is tested. isORPCErrorJson then recognizes it
 *              as exactly { defined, code, status, message, data } with no extra
 *              keys (client.hRLEpIKU.mjs:176). A transport failure (502, HTML
 *              error page, unreachable API) never matches that shape and is
 *              reported separately, so "the server said no" and "the server was
 *              not reachable" stay distinguishable in the UI.
 *
 * ## COOKIES
 *
 * `credentials: "include"` is required, and it is the same reason the dev
 * proxy in vite.config.ts keeps `changeOrigin: false`. The session is a
 * better-auth cookie; without it the browser drops the credential and every
 * request reads as anonymous.
 */

import type { AppRouter } from "@mcpedia/api"
/**
 * The procedure tree, as a TYPE ONLY.
 *
 * `import type` is erased at compile time, so this pulls nothing into the
 * browser bundle — which is exactly what the build guard (build/no-server-imports.ts)
 * keys on: anything that survives to resolveId is a runtime import and is
 * denied. The type is what gives every call site its return type, so a handler
 * that changes shape on the server becomes a typecheck error here instead of a
 * blank panel in production.
 *
 * ## WHY RouterClient IS APPLIED HERE AND NOT IMPORTED
 *
 * apps/api exports a ready-made `AppRouterClient`, but importing that
 * pre-applied type from another workspace yields `unknown` for every
 * procedure. `RouterClient<R, C>` is a DEFERRED conditional
 * (`T extends Lazyable<infer U> ? RouterClient<U> : never`), and when the
 * already-evaluated result crosses a package boundary the lazy branch no
 * longer matches, so every lookup collapses to unknown.
 *
 * Verified by probe: importing `AppRouterClient` gives `unknown`; importing
 * `AppRouter` and applying `RouterClient` in THIS file gives the real type.
 * So the generic is applied here, and the inference lives in one place.
 */
import type { RouterClient } from "@orpc/server"

export type AppRouterClient = RouterClient<AppRouter, Record<never, never>>
export type { AppRouter }

/**
 * The resolved output type of one procedure client.
 *
 * A RouterClient node is NOT a function — it is an object carrying
 * `~standard`/`~rpc` and the callable signatures — so `ReturnType<...>` does not
 * apply and resolves to `unknown` (or fails the constraint outright). The
 * output is recoverable from the call signatures via `infer`, which is what the
 * two aliases below do.
 * Unwrap a client result to the value the handler returns.
 *
 * `Awaited` MUST NOT be applied here. oRPC's `ClientPromiseResult` is a
 * thenable-but-not-a-Promise — it carries `~standard`/`~rpc` next to `then` —
 * and `Awaited<ClientPromiseResult<Document | null, Error>>` resolves to
 * `unknown`, because `Awaited` walks the thenable's overloaded `then` and picks
 * up its rejection branch. Verified by probe:
 *
 *     Awaited<...>                 -> unknown      <- wrong
 *     bare `infer V` from `then`   -> Document|null <- correct
 *
 * So the value is read straight out of `then`'s onFulfilled parameter and
 * unwrapped only once.
 */
type Unwrap<T> = T extends {
	then(onFulfilled: (v: infer V) => unknown): unknown
}
	? V
	: T

/**
 * The return type of the procedure named by `P`.
 *
 * This is what makes the client type-safe WITHOUT the oRPC runtime. The router
 * is a value on the server, but its client-facing TYPE travels fine, and
 * indexing it by the same path segments used in the request builds the mapping:
 *
 *     rpcCall(RPC_BASE, ["documents", "get"], { slug })
 *       -> the resolved output of AppRouterClient["documents"]["get"]
 *
 * A handler that changes shape server-side therefore breaks the build here
 * rather than at runtime. Hand-writing the type at each call site is what
 * produced the `unknown` cascade this replaces.
 */
export type ProcedureResult<P extends readonly string[]> = P extends readonly [
	infer H extends string,
	...infer Tail extends string[],
]
	? NodeAt<AppRouterClient, H> extends infer Node
		? Walk<Node, Tail>
		: unknown
	: unknown

/**
 * The router node named by `K`, or `never` when there is no such node.
 *
 * Written with `infer` rather than indexed access (`C[K]`) ON PURPOSE. The
 * indexed form silently yields `unknown` across this package boundary — every
 * lookup "succeeds" but resolves to nothing — while an `infer` match on the
 * same node preserves the real type. Verified by probe:
 *
 *     AppRouterClient["documents"]["get"]              -> unknown   <- useless
 *     AppRouterClient extends { documents: infer D }  -> Document|null <- works
 *
 * Both forms are legal TypeScript and neither reports an error, which is why
 * this is worth a comment: the failure is invisible except as lost types.
 */
type NodeAt<C, K extends string> = C extends { [P in K]: infer N } ? N : never

/**
 * Walk the remaining path segments, one router node at a time, and return the
 * final node's resolved output.
 */
type Walk<Node, Tail extends readonly string[]> = Tail extends readonly [
	infer N extends string,
	...unknown[],
]
	? NodeAt<Node, N> extends infer Next
		? Next extends (...args: never[]) => infer R
			? Unwrap<R>
			: Walk<Next, []>
		: unknown
	: Node extends (...args: never[]) => infer R
		? Unwrap<R>
		: unknown

/** Shape of the ORPCError body the API returns for a rejected call. */
interface OrpcErrorJson {
	defined: boolean
	code: string
	status: number
	message: string
	data?: unknown
}

/**
 * Is this an ORPCError body, per isORPCErrorJson?
 *
 * The real predicate requires EXACTLY the five known keys — a payload with an
 * extra key is not an error envelope. That strictness is what stops a document
 * that happens to contain fields called `code`/`status` from being misread as a
 * failure, so it is reproduced rather than loosened.
 */
export function isOrpcErrorJson(value: unknown): value is OrpcErrorJson {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false
	}
	const keys = Object.keys(value as Record<string, unknown>)
	const valid = ["defined", "code", "status", "message", "data"]
	if (!keys.every((k) => valid.includes(k))) return false
	const o = value as Record<string, unknown>
	return (
		typeof o.defined === "boolean" &&
		typeof o.code === "string" &&
		typeof o.status === "number" &&
		(o.status < 200 || o.status >= 400) &&
		typeof o.message === "string"
	)
}

/** A call the API rejected. Carries the API's own code and status. */
export class OrpcCallError extends Error {
	readonly code: string
	readonly status: number
	constructor(body: OrpcErrorJson) {
		super(body.message)
		this.name = "OrpcCallError"
		this.code = body.code
		this.status = body.status
	}
}

/**
 * The API could not be reached, or answered with something that is not the RPC
 * protocol at all (a proxy error page, a wrong port, a hung connection).
 *
 * Deliberately a DIFFERENT type from OrpcCallError. The gate in the create page
 * distinguishes "your session is not an admin, log in again" (an OrpcCallError
 * with UNAUTHORIZED) from "the API is down" (this) — collapsing them would
 * send an operator to the login page when the real problem is a dead backend.
 */
export class OrpcTransportError extends Error {
	readonly status?: number
	constructor(message: string, status?: number) {
		super(message)
		this.name = "OrpcTransportError"
		this.status = status
	}
}

/**
 * Join a procedure path onto the mount point the way toHttpPath does:
 * each segment is encoded separately, so a slug containing a slash cannot
 * forge an extra path segment.
 */
export function rpcUrl(base: string, path: readonly string[]): string {
	const encoded = path.map(encodeURIComponent).join("/")
	return `${base.replace(/\/$/, "")}/${encoded}`
}

/** Pull the RPC payload out of a decoded response body. */
function unwrap(body: unknown): unknown {
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return body
	}
	// `meta` is absent whenever the payload held nothing needing meta entries,
	// so only `json` is required here.
	return (body as { json?: unknown }).json
}

/**
 * Build the request body for a call.
 *
 * For a procedure with no input the body is `{}` — NOT `{"json":null}`.
 * That is what oRPC's own codec sends: StandardRPCSerializer produces
 * `{ json, meta }` where `json` is the serialized input, and serializing
 * `undefined` yields a dropped key, which `stringifyJSON` (a bare
 * JSON.stringify) then omits. The server decodes with `deserialize(body)`,
 * so the absent key comes back as `undefined` — the value the input validator
 * sees for a no-input procedure. Sending an explicit `null` instead would
 * reach zod as a literal null, which is a different value and fails
 * `.optional()` on a schema that only tolerates undefined.
 */
export function rpcBody(input?: unknown): string {
	return input === undefined ? "{}" : JSON.stringify({ json: input })
}

/**
 * Call one procedure.
 *
 * `input` is omitted (not sent as `null`) for procedures with no input — see
 * rpcBody.
 */
export async function rpcCall<P extends readonly string[]>(
	base: string,
	path: P,
	input?: unknown,
	init?: { signal?: AbortSignal },
): Promise<ProcedureResult<P>> {
	let response: Response
	try {
		response = await fetch(rpcUrl(base, path), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// The session cookie. Same-origin in production (Caddy serves both),
			// proxied same-origin in dev.
			credentials: "include",
			body: rpcBody(input),
			...(init?.signal ? { signal: init.signal } : {}),
		})
	} catch {
		throw new OrpcTransportError(
			`Could not reach the wiki API at ${base}. Is it running?`,
		)
	}

	// A non-JSON body here is the proxy or the origin failing, not the protocol.
	const contentType = response.headers.get("content-type") ?? ""
	if (!contentType.includes("application/json")) {
		throw new OrpcTransportError(
			`The wiki API returned ${response.status} ${response.statusText} (not an RPC response).`,
			response.status,
		)
	}

	let body: unknown
	try {
		body = await response.json()
	} catch {
		throw new OrpcTransportError(
			"The wiki API returned a malformed RPC response.",
			response.status,
		)
	}

	// UNWRAP BEFORE CHECKING FOR AN ERROR. The server's encodeError also nests
	// the envelope: `body: this.serializer.serialize(error.toJSON())` produces
	// `{ json: { defined, code, status, message } }`, and the installed client's
	// decode unwraps first and only then calls isORPCErrorJson. Checking the
	// un-unwrapped body misses every rejection and hands the caller an error
	// object dressed up as a successful result.
	const payload = unwrap(body)

	if (isOrpcErrorJson(payload)) {
		throw new OrpcCallError(payload)
	}

	return payload as ProcedureResult<P>
}
