import { os } from "@orpc/server"
import { resolveSession } from "../context"
import { mapAppErrors } from "../middleware"

/**
 * Who is calling, if anyone.
 *
 * Public and non-throwing on purpose: a page asks this to decide whether to
 * render the editor, so "not authenticated" is a normal answer, not an error. It
 * answers 200 with `authenticated: false` rather than 401, which is what lets a
 * page render read-only content without an error boundary.
 *
 * ## THE RESPONSE SHAPE IS UNCHANGED
 *
 * `{ authenticated, role, via }` is what the SPA already consumes, and it is
 * unchanged — `via` merely gained a second possible value. The SPA's client type
 * declares `via: string | null` for exactly this reason, so adding "session" did
 * not break its build.
 *
 * ## WHY IT IS NOW ASYNC
 *
 * Resolving a session cookie reads the `session` table. That cost is paid only
 * when a caller needs it: `resolveSession` checks the webhook secret first — a
 * constant-time comparison, no I/O — and returns immediately on the MCP path, so
 * the stdio client never triggers a query.
 */
export const authRouter = os.router({
	me: os.use(mapAppErrors).handler(async ({ context }) => {
		const session = await resolveSession(context)
		return {
			authenticated: session !== null,
			role: session?.role ?? null,
			via: session?.via ?? null,
		}
	}),
})
