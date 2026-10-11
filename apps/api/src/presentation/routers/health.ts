import { os } from "@orpc/server"
import { asApiContext } from "../context"

/**
 * Liveness for the RPC surface.
 *
 * The plain Hono `GET /health` still exists and is unchanged — this is the RPC
 * equivalent, so an oRPC client can probe the same way it calls everything else.
 */
export const healthRouter = os.router({
	ping: os.handler(({ context }) => {
		const { expectedSecret } = asApiContext(context)
		return { ok: true, expectedSecretConfigured: Boolean(expectedSecret) }
	}),
})
