import { os } from "@orpc/server"
import { resolveSession } from "../context"

/**
 * Who is calling, if anyone.
 *
 * Public and non-throwing on purpose: a server component asks this to decide
 * whether to render the editor, so "not authenticated" is a normal answer, not
 * an error. It answers 200 with `authenticated: false` rather than 401, which
 * is what lets a page render read-only content without an error boundary.
 *
 * This reports on the SECRET path only. It deliberately knows nothing about the
 * web admin cookie: that cookie's HMAC key lives in the web app
 * (apps/web/app/lib/auth.ts), which is the only place it is available.
 */
export const authRouter = os.router({
	me: os.handler(({ context }) => {
		const session = resolveSession(context)
		return {
			authenticated: session !== null,
			role: session?.role ?? null,
			via: session?.via ?? null,
		}
	}),
})
