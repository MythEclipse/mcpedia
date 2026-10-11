/**
 * Error classification for the oRPC client.
 *
 * The retry decision in main.tsx needs to know whether a failure is worth
 * repeating, and "is it a 404" is not something a generic Error can answer.
 * oRPC rejects with an ORPCError carrying the procedure's HTTP status, so this
 * wraps that into the one question the UI actually asks: retry or not?
 *
 * Kept separate from src/api/client.ts so the retry policy (main.tsx) does not
 * have to import the transport to find out about errors.
 */

/** Anything that reaches the UI from the API, with its status preserved. */
export class RPCError extends Error {
	readonly status: number

	constructor(message: string, status: number) {
		super(message)
		this.name = "RPCError"
		this.status = status
	}

	/**
	 * Whether repeating the request could plausibly succeed.
	 *
	 * 4xx means the server understood and declined — a missing document, a bad
	 * slug, a rejected write. Repeating it gets the same answer. 5xx and network
	 * failures are the ones worth one more attempt.
	 */
	get retryable(): boolean {
		return this.status === 0 || this.status >= 500
	}
}

/** oRPC's NOT_FOUND code, which is what a missing document resolves to. */
export const NOT_FOUND = "NOT_FOUND"

/** True when an error means "no such document", not "the request broke". */
export function isNotFound(error: unknown): boolean {
	return error instanceof RPCError && error.status === 404
}

/**
 * The message to show a user.
 *
 * oRPC's own message for an unexpected failure is the literal string
 * "Something went wrong", which tells a reader nothing. Anything that is not
 * an RPCError is assumed to be a transport failure and gets a message that
 * says what to actually do about it.
 */
export function errorMessage(error: unknown): string {
	if (error instanceof RPCError) return error.message
	if (error instanceof Error) return error.message
	return "Something went wrong"
}
