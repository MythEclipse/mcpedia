/**
 * STARTUP ENV VALIDATION — the "fail before serving traffic" gate.
 *
 * ## WHY THIS EXISTS SEPARATELY FROM THE SCHEMA IN ./index.ts
 *
 * `packages/config/src/index.ts` already runs a Zod schema over every variable,
 * and it deliberately does NOT throw when a required value is missing. That is
 * the right call for the module itself: it is imported by browser bundles, by
 * the Vitest suite, and by the drizzle CLI, none of which need a live database.
 * Throwing at import time would make `import "@mcpedia/config"` mean "start the
 * application", which is how a test run on a developer laptop ends up trying to
 * connect to production Postgres.
 *
 * The cost of that decision is that a MISCONFIGURED deployment boots. The
 * failure surfaces later, at the point of use, as a confusing driver error or a
 * 500 with no mention of the missing key. This module is the other half of the
 * bargain: it is called ONCE, from a process entrypoint, and it throws with the
 * complete list of problems at once.
 *
 * "All at once" is the whole point. Fixing one missing key per restart — the
 * behaviour you get from `requireEnv` at each call site — means a
 * three-variable misconfiguration costs four deploys to find. Here it is one.
 *
 * ## WHY IT IS NOT A `.env` LOADER
 *
 * It reads the already-resolved exports from `./index.ts` rather than parsing
 * `.env` again. One resolution path, one set of precedence rules (`.env` beats
 * an inherited shell value, deliberately). A second parser would be a second
 * place for precedence to drift.
 */
import { z } from "zod"
import {
	BETTER_AUTH_SECRET,
	BETTER_AUTH_URL,
	DATABASE_URL,
	EMBED_API_KEY,
	EMBED_BASE_URL,
	EMBED_MODEL,
	REDIS_PASSWORD,
	REDIS_URL,
	WEBHOOK_SECRET,
} from "./index.ts"

/**
 * What the API process actually needs in order to serve traffic.
 *
 * This is NOT the full environment. It is the subset whose absence makes the
 * API either unable to start or silently useless:
 *
 *   - DATABASE_URL absent      → every repository call throws. Not degraded,
 *                                broken.
 *   - BETTER_AUTH_SECRET absent→ `getAuth()` cannot construct, so the session
 *                                gate is unavailable and every write is refused.
 *   - WEBHOOK_SECRET absent    → the MCP write path is DISABLED. That is the
 *                                designed behaviour (fail-closed), not an
 *                                error, so it is a warning here — see
 *                                `severity` below. A deployment that intends
 *                                to serve both MCP and browser writes and has
 *                                no secret set gets told so explicitly.
 */
const StartupSchema = z.object({
	DATABASE_URL: z
		.string()
		.min(1, "required — the API cannot reach Postgres without it")
		.refine((v) => /^postgres(ql)?:\/\//.test(v), {
			message: "must be a postgres:// or postgresql:// URL",
		}),
	BETTER_AUTH_SECRET: z
		.string()
		.min(1, "required — better-auth signs session cookies with it")
		.min(
			16,
			"must be at least 16 characters; generate with `openssl rand -hex 32`",
		),
	BETTER_AUTH_URL: z
		.string()
		.min(1, "required — better-auth derives trusted origins from it")
		.url("must be a valid URL, e.g. https://mcpedia.example.com"),
	// `.optional()` alone accepts an EMPTY STRING, which is not the same as
	// "unset": the resolved config turns a missing key into `""`, so an
	// operator who leaves WEBHOOK_SECRET blank would sail past a check that is
	// supposed to warn them about exactly that. `.min(1)` is what makes the
	// distinction — absent stays undefined, blank becomes a reported problem.
	WEBHOOK_SECRET: z
		.string()
		.min(1, "required — MCP writes authenticate with this header")
		.optional(),
	REDIS_URL: z
		.string()
		.min(1)
		.refine((v) => /^rediss?:\/\//.test(v), {
			message: "must be a redis:// or rediss:// URL",
		}),
	REDIS_PASSWORD: z.string().optional(),
	EMBED_BASE_URL: z.string().optional(),
	EMBED_API_KEY: z.string().optional(),
	EMBED_MODEL: z.string().optional(),
})

/**
 * A problem found in the environment, with whether it is fatal.
 *
 * `fatal: false` means the API can legitimately start without it. The webhook
 * secret is the only such case, and it is only a warning when the deployment
 * is not expected to serve MCP writes — so that judgement is the caller's, via
 * `requireWebhookSecret`.
 */
export interface EnvProblem {
	readonly key: string
	readonly message: string
	readonly fatal: boolean
}

export interface StartupEnvReport {
	readonly problems: readonly EnvProblem[]
	readonly fatal: readonly EnvProblem[]
	readonly warnings: readonly EnvProblem[]
}

/** Variables whose absence is a design decision rather than a misconfiguration. */
const OPTIONAL_BY_DESIGN = new Set(["WEBHOOK_SECRET"])

/**
 * Collect every environment problem at once.
 *
 * Returns a report instead of throwing so the caller decides how loud to be —
 * a CLI may want to print and continue, a server process wants to die. Keeping
 * the decision at the call site is what lets the Vitest suite exercise this
 * function without a live Postgres.
 */
export function collectStartupEnv(
	overrides: Partial<Record<string, string>> = {},
): StartupEnvReport {
	// Precedence matches ./index.ts exactly: an explicit override (the test
	// case, or a platform that injects a computed value) beats the resolved
	// export. Anything not overridden falls through to the real environment.
	const values: Record<string, string> = {
		DATABASE_URL,
		BETTER_AUTH_SECRET,
		BETTER_AUTH_URL,
		WEBHOOK_SECRET,
		REDIS_URL,
		REDIS_PASSWORD,
		EMBED_BASE_URL,
		EMBED_API_KEY,
		EMBED_MODEL,
		...overrides,
	}

	const parsed = StartupSchema.safeParse(values)
	if (parsed.success) {
		return { problems: [], fatal: [], warnings: [] }
	}

	const problems: EnvProblem[] = parsed.error.issues.map((issue) => {
		const key = String(issue.path[0] ?? "(root)")
		return {
			key,
			message: issue.message,
			// A key that is optional by design is never fatal, even when it is
			// also empty. Everything the schema marks required is.
			fatal: !OPTIONAL_BY_DESIGN.has(key),
		}
	})

	return {
		problems,
		fatal: problems.filter((p) => p.fatal),
		warnings: problems.filter((p) => !p.fatal),
	}
}

/** Render a report as the message shown to an operator. */
export function formatEnvReport(report: StartupEnvReport): string {
	const lines: string[] = []
	if (report.fatal.length > 0) {
		lines.push(`✗ ${report.fatal.length} fatal environment problem(s):`)
		for (const p of report.fatal) lines.push(`    ${p.key}: ${p.message}`)
	}
	if (report.warnings.length > 0) {
		lines.push(`⚠ ${report.warnings.length} warning(s):`)
		for (const p of report.warnings) lines.push(`    ${p.key}: ${p.message}`)
	}
	return lines.join("\n")
}

/**
 * Assert the environment is usable, or throw with EVERY problem listed.
 *
 * Call this once, from a process entrypoint, before binding a port. A process
 * that binds :4020 with an unconfigured database accepts traffic it cannot
 * serve, and the health check reports "up" while every request 500s — the
 * failure mode this exists to prevent.
 */
export function assertStartupEnv(
	overrides: Partial<Record<string, string>> = {},
): void {
	const report = collectStartupEnv(overrides)
	if (report.fatal.length === 0) return

	const lines = [
		formatEnvReport(report),
		"",
		"Set these in the process environment (deploy) or in the repo .env (local).",
		"There are no defaults: an unset secret must disable the feature it guards,",
		"never fall back to a key committed to the repository.",
	]
	throw new Error(lines.join("\n"))
}

/**
 * Assert the webhook secret specifically, for a deployment that intends to
 * serve MCP writes.
 *
 * Separate from `assertStartupEnv` because its absence is legitimate for a
 * browser-only deployment and fatal for an MCP one — a judgement only the
 * operator can make, so the caller states it.
 */
export function assertWebhookSecret(value: string = WEBHOOK_SECRET): void {
	if (value) return
	throw new Error(
		"WEBHOOK_SECRET is not set. This deployment serves MCP writes, which " +
			"authenticate with `x-webhook-secret`. Set it in the environment; there " +
			"is no default.",
	)
}
