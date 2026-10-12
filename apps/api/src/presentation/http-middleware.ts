/**
 * Cross-cutting HTTP middleware for the API process.
 *
 * ## WHY A SEPARATE MODULE
 *
 * `app.ts` builds the application. This file builds the chain that runs in front
 * of every route. They are separated so the chain can be unit-tested as a value
 * — `app.use(...)` calls inside `createApp` cannot be asserted on without
 * mounting a whole Hono app around them, and a middleware nobody can test is a
 * middleware nobody changes safely.
 *
 * ## ORDER, AND WHY THIS ORDER
 *
 *   requestId → logger → secureHeaders → cors → routes
 *
 * The order is not arbitrary. Two of these depend on it:
 *
 *   1. requestId FIRST, so the logger and every downstream error line already
 *      have an id to attach. Generating it later means the first log line of a
 *      request — usually the one you need — has no correlation id.
 *
 *   2. secureHeaders BEFORE cors. Hono's CORS handler answers an OPTIONS
 *      preflight and returns directly, so any header registered after it never
 *      reaches the browser on the preflight. Security headers first means they
 *      are present on both the preflight and the actual response.
 *
 * `logger` sits between them so it observes the final status code, including
 * the 401 and 403 the auth gates produce — the requests most worth having a
 * line for.
 */
import { cors } from "hono/cors"
import { logger } from "hono/logger"
import { requestId } from "hono/request-id"
import { secureHeaders } from "hono/secure-headers"
import type { MiddlewareHandler } from "hono"

/**
 * Options that depend on deployment shape rather than on code.
 *
 * `allowedOrigins` is needed for CORS because the session cookie is httpOnly
 * and `SameSite` defaults would drop it on a cross-origin call — so in every
 * supported single-image deployment the browser and the API are same-origin and
 * CORS is effectively inert. It is configured rather than removed because the
 * split deploy mode (spec §11) exists, and a wildcard is not available once
 * credentials are involved.
 */
export interface HttpMiddlewareOptions {
	readonly allowedOrigins: readonly string[]
}

/**
 * The header carrying the request id.
 *
 * Custom rather than `X-Request-Id` so an upstream proxy that stamps its own
 * id cannot be silently shadowed by a client-supplied one, and so it cannot
 * collide with a convention an unrelated tool in the path expects.
 */
export const REQUEST_ID_HEADER = "X-Mcpedia-Request-Id"

/**
 * Build the middleware chain.
 *
 * `credentials: true` is required, not decorative: the better-auth session
 * cookie is the only credential the browser path has, and without this the
 * browser drops it on every call even when the origin matches.
 *
 * `generator` is Hono's default (a random UUID v4) and is passed explicitly for
 * one reason: a client must never be able to choose a request id. If the id is
 * accepted from the caller, log correlation becomes forgeable — a caller picks
 * an id that already appears in an unrelated request's line.
 */
export function createHttpMiddleware(
	options: HttpMiddlewareOptions,
): MiddlewareHandler[] {
	const origins = [...options.allowedOrigins]

	return [
		requestId({
			headerName: REQUEST_ID_HEADER,
			generator: () => crypto.randomUUID(),
		}),
		logger(),
		secureHeaders({
			// CSP is configured per-response rather than globally. A global policy
			// has to be the intersection of every route's needs, and the one HTML
			// page this API serves (the metrics dashboard) carries an inline
			// stylesheet — a default-src policy would silently disable its styling
			// while still reporting "enabled". The routes that need a policy set
			// their own; nothing else opts in.
			strictTransportSecurity: "max-age=31536000; includeSubDomains",
			xContentTypeOptions: "nosniff",
			referrerPolicy: "no-referrer",
			removePoweredBy: true,
		}),
		cors({
			origin: origins,
			credentials: true,
			allowHeaders: ["Content-Type", "x-webhook-secret", REQUEST_ID_HEADER],
			allowMethods: ["GET", "POST", "OPTIONS"],
			maxAge: 600,
		}),
	]
}
