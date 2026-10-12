/**
 * Typed errors, in the domain layer because the innermost layer raises them.
 *
 * ## WHY HERE AND NOT IN application/
 *
 * `validateSlug` — pure domain logic — throws on an invalid slug, and it is the
 * thing that decides whether a caller may create a document at all. So the type
 * has to be nameable from `domain/`, which means it cannot live one layer up:
 * `domain` importing `application` would invert the dependency rule and make
 * the innermost layer depend on the one that depends on it. Declared here, both
 * `domain/path.ts` and `application/*.use-cases.ts` can throw it, and neither
 * reaches outward.
 *
 * ## WHY THIS EXISTS
 *
 * Every failure in this package used to be a bare `new Error("document already
 * exists at slug: x")`. That carries a message and nothing else, so the
 * transport had no way to distinguish a caller mistake from a broken server and
 * answered 500 to all of them — including the ones a caller can fix.
 *
 * oRPC (and every other transport) carries a real status on its error type, so
 * a typed error here becomes a correct status at the edge with no per-transport
 * string matching. `AppError` is that type.
 *
 * ## THE MESSAGES ARE UNCHANGED, AND THAT IS THE POINT
 *
 * The `message` of every factory below is the exact string the previous bare
 * throw used, so a log line, a grep, and an existing test assertion all keep
 * working. What changed is the TYPE, not the text. `validateSlug` still says
 * `invalid slug: ...`, so `path.test.ts` needs no edit.
 *
 * ## WHY THE CODES ARE NAMED
 *
 * The strings are shared verbatim with the presentation layer's mapping table,
 * which is what lets one table decide both the code and the HTTP status. Adding
 * a case here without a row there is a compile error at the mapping, not a
 * silent 500 at runtime.
 */

/** The failures this application raises deliberately. */
export type AppErrorCode =
	| "BAD_REQUEST"
	| "CONFLICT"
	| "NOT_FOUND"
	| "FORBIDDEN"
	| "UNAUTHORIZED"
	| "INTERNAL_ERROR"

/**
 * The brand that marks a value as an AppError.
 *
 * `Symbol.for` uses the GLOBAL symbol registry, so two copies of this module in
 * one process produce the SAME symbol. That matters because `instanceof` compares
 * constructor identity: with two loaded copies — a duplicated workspace package,
 * a bundler that inlines core twice, or a test that mocks the module — an
 * AppError built by one copy fails `instanceof AppError` in the other and would
 * be reclassified as an unknown fault, turning a 409 into a 500.
 */
const APP_ERROR_BRAND = Symbol.for("mcpedia.AppError")

/** A failure with a code a transport can map to a status. */
export class AppError extends Error {
	readonly code: AppErrorCode

	constructor(code: AppErrorCode, message: string) {
		super(message)
		this.name = "AppError"
		this.code = code
		// Non-enumerable: the brand is an internal marker, not payload. It must
		// not show up in a JSON dump or a structured log line.
		Object.defineProperty(this, APP_ERROR_BRAND, {
			value: true,
			enumerable: false,
		})
	}
}

/**
 * The caller sent something the rules reject: an invalid slug, a malformed id.
 *
 * The slug factories are the security boundary for anything that becomes a file
 * path, which is why this is a BAD_REQUEST and not a crash — a traversal attempt
 * is the caller's error, and it must be reported as one.
 */
export function badRequest(message: string): AppError {
	return new AppError("BAD_REQUEST", message)
}

/** The request was well-formed but conflicts with what already exists. */
export function conflict(message: string): AppError {
	return new AppError("CONFLICT", message)
}

/** The thing named by the request does not exist. */
export function notFound(message: string): AppError {
	return new AppError("NOT_FOUND", message)
}

/** A caller who may read may not do this. */
export function forbidden(message: string): AppError {
	return new AppError("FORBIDDEN", message)
}

/** No usable credential was presented. */
export function unauthorized(message: string): AppError {
	return new AppError("UNAUTHORIZED", message)
}

/** Something outside the caller's control failed. */
export function internal(message: string): AppError {
	return new AppError("INTERNAL_ERROR", message)
}

/**
 * Narrow an unknown thrown value to an AppError, or null.
 *
 * ## WHY A BRAND AND NOT `instanceof`
 *
 * `err instanceof AppError` compares constructor identity, which fails as soon as
 * two copies of this module exist in one process: a duplicated workspace package,
 * a bundler that inlines core into two chunks, or a test that mocks
 * `@mcpedia/core` without re-exporting the class. In every one of those cases a
 * genuine AppError arrives here, fails `instanceof`, and is reported as an
 * unknown fault — a 409 silently downgraded to a 500. This was observed for real
 * in this repo: `apps/api`'s tests mock `@mcpedia/core`, and the mapper's call to
 * `asAppError` came back undefined, so every typed error became a 500.
 *
 * The brand check works across module copies because `Symbol.for` resolves through
 * the global symbol registry, which is shared per process. It is also strictly
 * narrower than a duck-type on `.code`: a foreign library error carrying a `code`
 * property (Postgres drivers all do — `ECONNREFUSED`, `23505`) has no brand and
 * correctly stays an unknown fault instead of being re-labelled with a status this
 * application chose.
 *
 * The code is validated against the known set as well, so a hand-rolled
 * `{ [brand]: true, code: "NOPE" }` is rejected rather than mapped to 500.
 */
export function asAppError(err: unknown): AppError | null {
	if (typeof err !== "object" || err === null) return null
	const candidate = err as { [APP_ERROR_BRAND]?: unknown; code?: unknown }
	if (candidate[APP_ERROR_BRAND] !== true) return null
	if (!isAppErrorCode(candidate.code)) return null
	return err as AppError
}

const APP_ERROR_CODES = new Set<string>([
	"BAD_REQUEST",
	"CONFLICT",
	"NOT_FOUND",
	"FORBIDDEN",
	"UNAUTHORIZED",
	"INTERNAL_ERROR",
])

function isAppErrorCode(code: unknown): code is AppErrorCode {
	return typeof code === "string" && APP_ERROR_CODES.has(code)
}
