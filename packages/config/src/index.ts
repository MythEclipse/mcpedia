import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { existsSync, readFileSync } from "node:fs"
import { z } from "zod"

const here = dirname(fileURLToPath(import.meta.url))
// packages/config -> repo root (../../..)
export const REPO_ROOT = resolve(here, "../../..")

/**
 * Load .env (repo root) as the authoritative dev config and apply it to
 * process.env. We intentionally OVERRIDE any inherited DATABASE_URL so a stray
 * shell env var can never point the app at the wrong database. .env is
 * gitignored; for deploy, set the real vars in the environment and omit .env.
 *
 * Returns only the keys that were actually present, so callers can tell
 * "unset in .env" from "present but empty" — a distinction that decides which
 * source wins below.
 */
function readDotEnv(): Record<string, string> {
	const out: Record<string, string> = {}
	const dotEnv = resolve(REPO_ROOT, ".env")
	if (!existsSync(dotEnv)) return out
	for (const line of readFileSync(dotEnv, "utf8").split("\n")) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
		if (!m) continue
		const key = m[1]
		let val = m[2]
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1)
		}
		out[key] = val
		// Deliberately still written into process.env for any consumer that
		// reads process.env directly (the better-auth CLI, drizzle.config.ts).
		process.env[key] = val
	}
	return out
}

const dotEnv = readDotEnv()

/**
 * Resolve a variable the way loadDotEnv always has: `.env` wins over an
 * inherited shell value, because a stray DATABASE_URL in the shell must never
 * point the app at the wrong database. Unset anywhere means "".
 *
 * The DATABASE_URL override is the one behaviour here that is load-bearing and
 * deliberately NOT to be "fixed" into an env-wins scheme.
 */
const raw = (key: string): string => dotEnv[key] ?? process.env[key] ?? ""

/**
 * The env schema.
 *
 * Everything is optional and every unset value resolves to "". This is
 * deliberate and load-bearing: `next build` imports this module during static
 * generation with no .env present, and throwing at import time breaks the
 * build. Values that MUST be present (a database, a signing key) are checked by
 * the code that actually uses them, at request time, where the error can name
 * what is missing — see requireEnv below and apps/web's auth setup.
 *
 * The string shapes still get validated. A DATABASE_URL that is not a URL is a
 * typo that would otherwise surface as a confusing driver error much later, and
 * the zod failure names the exact key.
 */
const EnvSchema = z.object({
	CONTENT_ROOT: z.string().optional(),
	DATABASE_URL: z
		.string()
		.refine(
			(v) => v === "" || /^postgres(ql)?:\/\//.test(v),
			"DATABASE_URL must be a postgres:// or postgresql:// URL",
		)
		.optional(),
	EMBED_BASE_URL: z
		.string()
		.refine((v) => v === "" || /^https?:\/\//.test(v), {
			message: "EMBED_BASE_URL must be an http(s):// URL",
		})
		.optional(),
	EMBED_API_KEY: z.string().optional(),
	EMBED_MODEL: z.string().optional(),
	REDIS_URL: z
		.string()
		.refine((v) => v === "" || /^rediss?:\/\//.test(v), {
			message: "REDIS_URL must be a redis:// or rediss:// URL",
		})
		.optional(),
	REDIS_PASSWORD: z.string().optional(),
	QUEUE_PREFIX: z.string().optional(),
	WEBHOOK_SECRET: z.string().optional(),
	/**
	 * The single-admin bootstrap password, kept for the initial admin signup.
	 * Retired as an auth mechanism: it no longer signs or mints any cookie.
	 */
	ADMIN_PASSWORD: z.string().optional(),
	/**
	 * better-auth signs session cookies and derives key material from this. It
	 * has NO default, by design — a committed fallback key is the exact bug this
	 * repo already shipped once, and it authenticates everyone on any
	 * deployment that forgot to configure it.
	 */
	BETTER_AUTH_SECRET: z.string().optional(),
	/** better-auth's own base URL, used to derive trusted origins. */
	BETTER_AUTH_URL: z
		.string()
		.refine((v) => v === "" || /^https?:\/\//.test(v), {
			message: "BETTER_AUTH_URL must be an http(s):// URL",
		})
		.optional(),
})

const parsed = EnvSchema.safeParse({
	CONTENT_ROOT: raw("CONTENT_ROOT"),
	DATABASE_URL: raw("DATABASE_URL"),
	EMBED_BASE_URL: raw("EMBED_BASE_URL"),
	EMBED_API_KEY: raw("EMBED_API_KEY"),
	EMBED_MODEL: raw("EMBED_MODEL"),
	REDIS_URL: raw("REDIS_URL"),
	REDIS_PASSWORD: raw("REDIS_PASSWORD"),
	QUEUE_PREFIX: raw("QUEUE_PREFIX"),
	WEBHOOK_SECRET: raw("WEBHOOK_SECRET"),
	ADMIN_PASSWORD: raw("ADMIN_PASSWORD"),
	BETTER_AUTH_SECRET: raw("BETTER_AUTH_SECRET"),
	BETTER_AUTH_URL: raw("BETTER_AUTH_URL"),
})

if (!parsed.success) {
	// Log rather than throw: see the schema comment. This only fires on a
	// MALFORMED value, which is a config bug worth surfacing loudly, and a
	// broken URL would fail anyway at a much less legible point.
	const details = parsed.error.issues
		.map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
		.join("\n")
	console.error(`✗ invalid environment configuration:\n${details}\n`)
}

const env = parsed.success ? parsed.data : ({} as z.infer<typeof EnvSchema>)
const or = (value: string | undefined, fallback = "") => value || fallback

export const CONTENT_ROOT = or(env.CONTENT_ROOT, resolve(REPO_ROOT, "content"))

export const DATABASE_URL = or(env.DATABASE_URL)
export const EMBED_BASE_URL = or(env.EMBED_BASE_URL)
export const EMBED_API_KEY = or(env.EMBED_API_KEY)
export const EMBED_MODEL = or(env.EMBED_MODEL)

// Redis + BullMQ (shared Redis instance).
export const REDIS_URL = or(env.REDIS_URL, "redis://100.121.180.82:6379")
export const REDIS_PASSWORD = or(env.REDIS_PASSWORD)
export const QUEUE_PREFIX = or(env.QUEUE_PREFIX, "mcpedia")

// Git-sync webhook and API write shared secret.
export const WEBHOOK_SECRET = or(env.WEBHOOK_SECRET)

/**
 * Bootstrap admin password, used ONLY to seed the first `user` row's credential
 * on first run. It no longer authenticates a web request: the HMAC cookie it
 * used to sign is gone, and `apps/web` now authorizes against a better-auth
 * session. Retained because removing it would break the documented first-run
 * procedure, and because an existing deployment still has it set.
 */
export const ADMIN_PASSWORD = or(env.ADMIN_PASSWORD)

/**
 * better-auth's signing key. Empty when unset — never a fallback.
 *
 * Consumers must call requireEnv (or equivalent) rather than reading this
 * directly, so an unconfigured deployment fails with a nameable error instead
 * of running with a guessable key or refusing every request silently.
 */
export const BETTER_AUTH_SECRET = or(env.BETTER_AUTH_SECRET)
export const BETTER_AUTH_URL = or(env.BETTER_AUTH_URL)

/**
 * Read a variable that must not be empty, failing with a message that names it.
 *
 * This is the honest alternative to a fallback key: no default, no silent
 * failure, and no import-time throw (so `next build` still works) — the error
 * lands where the value is actually used.
 */
export function requireEnv(name: string, value: string): string {
	if (!value) {
		throw new Error(
			`${name} is not configured. Set it in ${resolve(REPO_ROOT, ".env")} (local) or in the ` +
				`process environment (deploy). There is no default: an unset secret must disable the ` +
				`feature, never fall back to a key committed to the repository.`,
		)
	}
	return value
}

// Dynamic Section registry & helpers — re-exported from a Node-free module.
export {
	SECTIONS,
	SECTIONS_BY_ID,
	SECTION_IDS,
	DEFAULT_SECTIONS,
	SECTION_PRESETS,
	getSectionMeta,
	type SectionConfig,
} from "./sections"

// NOTE: we deliberately do NOT throw here if DATABASE_URL is empty.
// Throwing at import time breaks `next build` SSG and any runtime-injected env.
// The same reasoning is why the embeddings provider does not validate its
// config at import time either.
