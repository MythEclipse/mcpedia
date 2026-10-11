import { toNextJsHandler } from "better-auth/next-js"
import { getAuth } from "@/lib/auth-server"

/**
 * better-auth's own endpoints (sign-in, sign-up, sign-out, get-session).
 *
 * This replaces a hand-rolled POST /api/auth/login that compared the submitted
 * password to ADMIN_PASSWORD and, on success, set a single HMAC cookie whose
 * value was the literal string "admin" for every login. better-auth issues a
 * per-session random token instead, persisted in the `session` table, with a
 * server-side expiry and a real user identity behind it.
 *
 * Route shape is `catch-all`: better-auth registers many paths under this
 * prefix, so they cannot be enumerated ahead of time.
 */

/**
 * Dispatch one request to better-auth.
 *
 * ## Why this is not `toNextJsHandler(getAuth())`
 *
 * That form evaluates getAuth() at MODULE SCOPE, and getAuth() throws when
 * BETTER_AUTH_SECRET is unset. `next build` runs a "Collecting page data" pass
 * that imports every route module with no .env present, so the build dies with
 * "Failed to collect configuration for /api/auth/[...all]" — the exact
 * import-time-throw trap @mcpedia/config and the embeddings provider both carry
 * comments about. Verified: this build failed that way before the wrapper.
 *
 * Resolving `getAuth()` inside the request keeps the build working. The secret
 * is still REQUIRED — it is checked when a request arrives, and the error names
 * the variable. Nothing here invents a fallback.
 *
 * ## Why not `toNextJsHandler(...)`'s returned map, spread directly
 *
 * It exports GET/POST/PATCH/PUT/DELETE all taking a bare `Request`. Next's
 * generated `.next/types/validator.ts` additionally constrains each export to
 * `(request: NextRequest, context: { params }) => ...`, so spreading the map
 * fails the build with TS2344. Restating the two methods we actually use, with
 * Next's own signature, satisfies it. `params` is unused: better-auth reads the
 * path from the Request, and dropping the parameter would not change routing.
 */
const routes = toNextJsHandler(
	(request: Request): Promise<Response> => getAuth().handler(request),
)

type RouteContext = { params: Promise<{ all: string[] }> }

export async function GET(request: Request, _context: RouteContext) {
	return await routes.GET(request)
}

export async function POST(request: Request, _context: RouteContext) {
	return await routes.POST(request)
}
