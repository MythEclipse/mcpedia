import type { AppError, AppErrorCode } from "@mcpedia/core"
import type { ORPCErrorCode } from "@orpc/client"
import { ORPCError } from "@orpc/client"

/**
 * The one place that decides what a failure means on the wire.
 *
 * ## WHY A TABLE AND NOT PER-CASE CONSTRUCTORS
 *
 * Two error vocabularies meet here and they must not drift:
 *
 *  - @mcpedia/core raises `AppError` with a code like `CONFLICT`.
 *  - This module's own gate raises failures directly as `ORPCError`.
 *
 * Written as parallel sets of `new ORPCError(...)` calls, the mapping would be a
 * judgement repeated at every site, and a new core code would silently default to
 * a 500. Written as one exhaustive table keyed by the shared code strings, an
 * unhandled code is a COMPILE error and the status for every code is readable in
 * one screen.
 *
 * `satisfies Record<AppErrorCode, number>` is what makes it exhaustive: add a
 * variant to AppErrorCode and this table fails to typecheck until it has a row.
 *
 * ## WHY `INTERNAL_ERROR` IS 500 AND THE REST ARE NOT
 *
 * Only INTERNAL_ERROR is a server fault. Everything else is something the caller
 * did or asked for, and reporting it as 500 sends an operator to read logs when
 * the correct response is to fix the request. Before this table core threw bare
 * Errors, so a duplicate slug and an unreachable database both arrived as 500 and
 * were indistinguishable.
 */
const STATUS_BY_CODE = {
	BAD_REQUEST: 400,
	CONFLICT: 409,
	NOT_FOUND: 404,
	FORBIDDEN: 403,
	UNAUTHORIZED: 401,
	INTERNAL_ERROR: 500,
} satisfies Record<AppErrorCode, number>

/**
 * oRPC's own code per application code, so a client can branch on it.
 *
 * `ORPCErrorCode` is a union of literal strings that is open to any `string & {}`,
 * so `satisfies` against it would NOT catch a typo. It is checked against
 * `AppErrorCode` instead — that is the side that actually changes — and the values
 * are the documented oRPC codes for each status.
 */
const ORPC_CODE_BY_CODE = {
	BAD_REQUEST: "BAD_REQUEST",
	CONFLICT: "CONFLICT",
	NOT_FOUND: "NOT_FOUND",
	FORBIDDEN: "FORBIDDEN",
	UNAUTHORIZED: "UNAUTHORIZED",
	INTERNAL_ERROR: "INTERNAL_SERVER_ERROR",
} satisfies Record<AppErrorCode, string>

/** The status this API answers with for a given application error code. */
export function statusFor(code: AppErrorCode): number {
	return STATUS_BY_CODE[code]
}

/**
 * Convert an AppError into the ORPCError the transport expects.
 *
 * Called from the procedure middleware, so a use case can throw a typed error and
 * never import oRPC. That is the point of the split: the domain names its
 * failures, and only this layer knows what a status code is.
 *
 * An INTERNAL_ERROR's message is REPLACED with a generic one, with the specific
 * text kept under `data.cause`. Core messages are written for an operator reading
 * a log; forwarding one to an unauthenticated caller can leak a slug, a path or a
 * table name, and the diagnostic value belongs in the server log.
 *
 * The generic parameter is explicit because `ORPCError<TCode, TData>` requires
 * both and neither has a default.
 */
export function toOrpcError(err: AppError): ORPCError<ORPCErrorCode, unknown> {
	if (err.code === "INTERNAL_ERROR") {
		return new ORPCError<ORPCErrorCode, unknown>("INTERNAL_SERVER_ERROR", {
			message: "internal error",
			data: { cause: err.message },
		})
	}
	return new ORPCError<ORPCErrorCode, unknown>(ORPC_CODE_BY_CODE[err.code], {
		message: err.message,
		status: statusFor(err.code),
	})
}

/** The write gate rejected the caller. */
export const ERR_UNAUTHORIZED = "UNAUTHORIZED" as const

/**
 * The write gate rejected the caller.
 *
 * Two distinct failures collapse to one code on purpose, and neither is a 5xx:
 *  - no secret configured  -> the deployment has writes DISABLED (fail closed)
 *  - missing/wrong secret  -> the caller is not authorized
 *
 * Callers get a 401 for both because that is the truth they can act on; the
 * code and message keep the two cases apart in logs.
 */
export function unauthorized(reason: "not-configured" | "invalid-secret") {
	return new ORPCError(ERR_UNAUTHORIZED, {
		message:
			reason === "not-configured"
				? "WEBHOOK_SECRET is not configured; writes are disabled"
				: "unauthorized: missing or invalid x-webhook-secret",
	})
}

/** The requested document / revision / job does not exist. */
export function notFound(what: string) {
	return new ORPCError("NOT_FOUND", { message: `${what} not found` })
}
