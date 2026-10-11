import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { existsSync, readFileSync } from "node:fs"

const here = dirname(fileURLToPath(import.meta.url))
// packages/config -> repo root (../../..)
export const REPO_ROOT = resolve(here, "../../..")

/**
 * Load .env (repo root) as the authoritative dev config and apply it to
 * process.env. We intentionally OVERRIDE any inherited DATABASE_URL so a stray
 * shell env var can never point the app at the wrong database. .env is
 * gitignored; for deploy, set the real vars in the environment and omit .env.
 */
function loadDotEnv() {
	const dotEnv = resolve(REPO_ROOT, ".env")
	if (!existsSync(dotEnv)) return
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
		process.env[key] = val
	}
}
loadDotEnv()

export const CONTENT_ROOT =
	process.env.CONTENT_ROOT ?? resolve(REPO_ROOT, "content")

export const DATABASE_URL = process.env.DATABASE_URL ?? ""
export const EMBED_BASE_URL = process.env.EMBED_BASE_URL ?? ""
export const EMBED_API_KEY = process.env.EMBED_API_KEY ?? ""
export const EMBED_MODEL = process.env.EMBED_MODEL ?? ""

// Redis + BullMQ (shared Redis instance).
export const REDIS_URL = process.env.REDIS_URL ?? "redis://100.121.180.82:6379"
export const REDIS_PASSWORD = process.env.REDIS_PASSWORD ?? ""
export const QUEUE_PREFIX = process.env.QUEUE_PREFIX ?? "mcpedia"

// Git-sync webhook and API write shared secret.
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? ""

// Admin password for web-based CRUD.
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? ""

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
