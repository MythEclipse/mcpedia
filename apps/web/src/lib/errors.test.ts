import { test, expect, describe } from "vitest"
import { RPCError, errorMessage, isNotFound } from "./errors"

/**
 * The retry policy in main.tsx branches on `error instanceof RPCError &&
 * !error.retryable`. If either half of that stopped holding, the app would
 * either retry a 404 forever or never retry a dropped connection — both of
 * which look like "search feels broken" rather than as a policy bug, so they
 * are pinned here.
 */
describe("RPCError", () => {
	test("keeps its status and message", () => {
		const err = new RPCError("Document not found", 404)
		expect(err.message).toBe("Document not found")
		expect(err.status).toBe(404)
		expect(err.name).toBe("RPCError")
		expect(err).toBeInstanceOf(Error)
	})

	test("4xx is not retryable — the server understood and declined", () => {
		for (const status of [400, 401, 403, 404, 409, 422]) {
			expect(new RPCError("x", status).retryable, `status ${status}`).toBe(
				false,
			)
		}
	})

	test("5xx is retryable — the server failed, not the request", () => {
		for (const status of [500, 502, 503, 504]) {
			expect(new RPCError("x", status).retryable, `status ${status}`).toBe(true)
		}
	})

	test("status 0 stands for a transport failure and is retryable", () => {
		// There is no HTTP response to consult when fetch itself fails.
		expect(new RPCError("Network request failed", 0).retryable).toBe(true)
	})

	test("isNotFound recognises only a 404", () => {
		expect(isNotFound(new RPCError("x", 404))).toBe(true)
		expect(isNotFound(new RPCError("x", 500))).toBe(false)
		expect(isNotFound(new Error("plain"))).toBe(false)
		expect(isNotFound(undefined)).toBe(false)
		expect(isNotFound("not an error")).toBe(false)
	})
})

describe("errorMessage", () => {
	test("passes an RPCError's message through", () => {
		expect(errorMessage(new RPCError("Document not found", 404))).toBe(
			"Document not found",
		)
	})

	test("passes a plain Error's message through", () => {
		expect(errorMessage(new Error("boom"))).toBe("boom")
	})

	test("never returns undefined for a non-Error throw", () => {
		expect(typeof errorMessage("a string")).toBe("string")
		expect(errorMessage({ weird: true })).toBe("Something went wrong")
		expect(errorMessage(null)).toBe("Something went wrong")
	})
})
