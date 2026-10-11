import { ORPCError } from "@orpc/client"

/**
 * Error codes this API raises deliberately.
 *
 * `UNAVAILABLE` is the important one: under tRPC the write gate threw a bare
 * `Error`, which the adapter reported as a 500 — an unconfigured deployment and
 * a forged credential were indistinguishable at the status-code level. oRPC
 * carries a real status on ORPCError, so the gate now returns 401 for both
 * (an operator cannot do anything about either by retrying) while keeping the
 * distinct code and message for diagnosis.
 */
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
