import { os } from "@orpc/server"
import { safeSecretEqual } from "../secret"
import { unauthorized } from "./error-mapping"
import { asApiContext } from "./context"

/**
 * Write gate for every state-changing procedure (revision.restore, and the three
 * document CRUD procedures).
 *
 * The check itself is unchanged from the tRPC router it replaces, and must stay
 * that way: the MCP server speaks this protocol over stdio where there is no
 * user session, so `x-webhook-secret` is the only credential available. An auth
 * migration that swept this up would reopen the three bypasses that were just
 * closed, so it is deliberately NOT shared with the web cookie path.
 *
 * Two properties are load-bearing:
 *  1. FAIL CLOSED — when WEBHOOK_SECRET is unset the gate refuses; it never
 *     falls through to "no secret configured, so allow".
 *  2. CONSTANT TIME — safeSecretEqual, so the comparison leaks neither the
 *     secret's value nor its length.
 *
 * The return value must be `next()`'s result: oRPC middlewares return
 * `{ output, context }`, and returning anything else (tRPC's `next()` returned
 * just the value) discards the handler's output.
 */
export const requireWriteAuth = os.middleware(async ({ context, next }) => {
	const ctx = asApiContext(context)

	// Fail closed: an unconfigured deployment must have writes DISABLED,
	// never unauthenticated-but-permitted.
	if (!ctx.expectedSecret) {
		throw unauthorized("not-configured")
	}

	if (
		!ctx.webhookSecret ||
		!safeSecretEqual(ctx.webhookSecret, ctx.expectedSecret)
	) {
		throw unauthorized("invalid-secret")
	}

	return next()
})
