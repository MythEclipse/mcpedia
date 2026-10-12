import { os } from "@orpc/server"
import { asAppError } from "@mcpedia/core"
import { safeSecretEqual } from "../secret"
import { toOrpcError, unauthorized } from "./error-mapping"
import { asApiContext, requireRole, WRITE_ROLE } from "./context"

/**
 * Translate a typed application error into a transport error.
 *
 * ## WHY THIS IS A MIDDLEWARE AND NOT PER-HANDLER
 *
 * The domain names its own failures — `conflict("document already exists...")`,
 * `notFound("document not found: x")`, `badRequest("invalid slug: ...")` — and it
 * must never import oRPC to report them. That separation is only worth anything
 * if the conversion happens in exactly one place, so a handler inherits it rather
 * than repeating a try/catch or importing `toOrpcError` by hand.
 *
 * ## WHY IT IS APPLIED PER PROCEDURE
 *
 * oRPC 1.15.5's `os.router(...)` returns a plain router with no `.use` method
 * (verified against the installed package: `typeof router.use === "undefined"`),
 * so there is no router-level middleware to hang this on. Applying it to each
 * procedure builder is the supported route, and it is why every router below
 * lists it explicitly.
 *
 * ## WHAT IS AND IS NOT REWRITTEN
 *
 * Only `AppError` is converted. A foreign exception — a Postgres driver error, a
 * bug in a use case — propagates untouched, so oRPC reports it as a genuine 500.
 * Folding those into a generic message would hide the failures an operator needs
 * a stack trace for.
 *
 * `next()`'s result is returned verbatim: oRPC middlewares yield
 * `{ output, context }`, and returning anything else discards the handler's output.
 */
export const mapAppErrors = os.middleware(async ({ next }) => {
	try {
		return await next()
	} catch (err) {
		const appError = asAppError(err)
		if (appError) throw toOrpcError(appError)
		throw err
	}
})

/**
 * The write gate's secret comparison, shared by both entry paths.
 *
 * Kept as a plain predicate rather than a middleware so the header path and the
 * session path cannot drift on the part that matters: what counts as a valid
 * secret, and the refusal when none is configured.
 *
 * Returns null when the credential is good, or a reason when it is not. Null is
 * the answer rather than `true` so the caller has to decide what a failure means
 * — the header path refuses outright, the combined path falls through to the
 * session check.
 */
export function verifyWebhookSecret(
	provided: string | undefined,
	expected: string,
): "not-configured" | "invalid-secret" | null {
	// Fail closed: an unconfigured deployment must have writes DISABLED,
	// never unauthenticated-but-permitted.
	if (!expected) return "not-configured"
	if (!provided || !safeSecretEqual(provided, expected)) return "invalid-secret"
	return null
}

/**
 * Write gate for every state-changing procedure (revision.restore, and the three
 * document CRUD procedures), on the secret path only.
 *
 * This is the MCP path. The MCP server speaks this protocol over stdio where
 * there is no browser and therefore no session cookie, so `x-webhook-secret` is
 * the only credential that can exist there. It is kept as a separate exported
 * middleware rather than folded into the combined gate, so the stdio path is
 * provable on its own: nothing about it can be affected by the session work.
 *
 * Two properties are load-bearing:
 *  1. FAIL CLOSED — when WEBHOOK_SECRET is unset the gate refuses.
 *  2. CONSTANT TIME — safeSecretEqual, so the comparison leaks neither the
 *     secret's value nor its length.
 */
export const requireWriteAuth = os.middleware(async ({ context, next }) => {
	const ctx = asApiContext(context)
	const reason = verifyWebhookSecret(ctx.webhookSecret, ctx.expectedSecret)
	if (reason) throw unauthorized(reason)
	return next()
})

/**
 * The write gate for browser callers: a valid secret OR an admin session.
 *
 * ## WHY THE BROWSER GETS A SESSION INSTEAD OF THE SECRET
 *
 * The SPA cannot hold WEBHOOK_SECRET. The browser bundle is public, so a secret
 * shipped to it is disclosed to every reader of the JavaScript — and the retired
 * HMAC cookie had exactly that problem. The session is the credential the browser
 * holds (an httpOnly cookie it never reads) while the secret stays the credential
 * the server keeps. That is why the SPA's write path sends no header at all.
 *
 * ## WHY THIS IS ADDITIVE AND NOT A LOOSENING
 *
 * Every property of the secret path is preserved:
 *
 *  - The comparison is still `verifyWebhookSecret` — the same helper, the same
 *    constant-time check, the same fail-closed refusal when WEBHOOK_SECRET is unset.
 *  - A caller WITH the secret still passes with no session, which is how MCP works.
 *  - A caller with NEITHER is refused, and the reason distinguishes the two cases.
 *
 * The only new acceptance is a session whose role is read from the database, so
 * there is no client-side value that can forge it.
 *
 * ## WHY THE ROLE IS CHECKED RATHER THAN "IS SIGNED IN"
 *
 * `requireRole(session, WRITE_ROLE)` requires the admin role. A signed-in
 * non-admin is a legitimate state that may read everything and write nothing;
 * accepting mere presence of a session would let any account edit documents.
 * It also reports the refusal accurately: 401 when there is no session at all,
 * 403 when there is one and the role is insufficient.
 */
export const requireWriteAuthOrSession = os.middleware(
	async ({ context, next }) => {
		const ctx = asApiContext(context)
		const secretReason = verifyWebhookSecret(
			ctx.webhookSecret,
			ctx.expectedSecret,
		)

		// The secret settles it outright: valid means through, and neither
		// "not-configured" nor "invalid-secret" reaches the session check. A
		// caller WITH the secret never triggers a database lookup, which is the
		// MCP path.
		if (secretReason === null) return next()

		// Otherwise fall through to the session. Note the deliberate asymmetry:
		// "not-configured" does NOT short-circuit to a refusal. It disables the
		// MCP path only — refusing here would let an unconfigured webhook secret
		// lock the browser out too, coupling two unrelated credentials. The
		// session decides on its own merits, and a refusal still reports
		// "invalid-secret" because from the caller's side that is the truth: they
		// presented nothing usable.
		// The session path distinguishes two refusals a single boolean cannot:
		// no session at all is a 401 (authenticate), and a session that is not an
		// admin is a 403 (authenticated, not permitted). Collapsing them into one
		// 401 told a signed-in non-admin that they had the wrong credentials when
		// they had the right ones and the wrong role.
		//
		// `requireRole` speaks the DOMAIN vocabulary (AppError) and is the single
		// authorization decision. `toOrpcError` is what puts it on the wire, and it
		// is called HERE rather than left to `mapAppErrors` for a reason that is
		// measured in middleware-order.test.ts: `.use(A).use(B)` runs A
		// outermost, so a throw raised in A never passes through B. `mapAppErrors`
		// is attached AFTER this gate, so it cannot see this throw — an AppError
		// escaping here arrived at the client as an opaque 500.
		//
		// Converting here keeps `requireRole` free of any transport knowledge while
		// guaranteeing the refusal is a real status. The mapAppErrors attached
		// after this middleware still does its job for everything DOWNSTREAM,
		// which is where the use cases live.
		const session = await ctx.loadSession()
		// `requireRole` is the single authorization decision — it knows that the
		// role axis is admin|user, that an unrecognised role is refused rather
		// than admitted, and that an absent session is a 401. It throws an
		// AppError because the domain must not know about status codes.
		//
		// The catch is what converts that refusal into a transport error, and it
		// lives HERE because `.use(A).use(B)` runs A outermost: this middleware's
		// own throw never passes through `mapAppErrors`, which is attached after
		// it. Without this catch an AppError escaped as an opaque 500 and a signed-
		// in non-admin was told their server was broken.
		//
		// Only AppError is converted. A genuine fault from the session lookup
		// below propagates untouched and is reported as the 500 it is.
		try {
			requireRole(session, WRITE_ROLE)
		} catch (err) {
			const appError = asAppError(err)
			if (!appError) throw err
			throw toOrpcError(appError)
		}
		return next()
	},
)
