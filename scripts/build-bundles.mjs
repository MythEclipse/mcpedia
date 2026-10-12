#!/usr/bin/env node
/**
 * Builds the three self-contained service bundles MCPedia runs in production.
 *
 * WHY A BUNDLE AT ALL: the sources import sibling workspace packages with
 * extensionless paths (`import { ... } from "@mcpedia/queue"` resolving to
 * TypeScript files), which Node cannot load on its own. The systemd launchers
 * therefore exec `node dist/index.js` — a single file with every workspace
 * import and every npm dependency already resolved into it.
 *
 * The `createRequire` banner is load-bearing: the output is ESM (`format:
 * "esm"`), and ESM has no `require`. Several bundled CommonJS dependencies call
 * `require(...)` at module scope; without this prelude esbuild's stub throws
 * "Dynamic require of X is not supported" the moment the service boots.
 *
 * Entrypoints and output names are exactly what the launchers under
 * /opt/mcpedia-api, /opt/mcpedia-mcp and /opt/mcpedia-worker point at, so
 * changing one without the other breaks a restart. Keep them in sync.
 */
import { build } from "esbuild"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { copyFileSync, mkdirSync, readdirSync, rmSync } from "node:fs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const CREATE_REQUIRE_BANNER = [
	'import { createRequire as __createRequire } from "node:module";',
	"const require = __createRequire(import.meta.url);",
].join("\n")

const BUNDLES = [
	{
		name: "api",
		entry: "apps/api/src/index.ts",
		outfile: "apps/api/dist/index.js",
	},
	{
		name: "mcp",
		entry: "apps/mcp/src/http.ts",
		outfile: "apps/mcp/dist/http.js",
	},
	{
		name: "worker",
		entry: "apps/worker/src/index.ts",
		outfile: "apps/worker/dist/index.js",
	},
	{
		// The migration worker, bundled like any other service.
		//
		// It used to run via `tsx apps/api/src/migrate.ts` on the host, which
		// means the deploy needed a checkout AND node_modules AND tsx — the whole
		// reason this host was still a builder. Bundling it removes the last
		// source-at-runtime dependency from the deploy path.
		//
		// The .sql files are NOT bundled: drizzle reads them from disk at runtime
		// through `new URL("../drizzle", import.meta.url)`. They are copied next
		// to the bundle below so that path still resolves once deployed.
		name: "migrate",
		entry: "apps/api/src/migrate.ts",
		outfile: "apps/api/dist/migrate.js",
	},
]

for (const { name, entry, outfile } of BUNDLES) {
	await build({
		entryPoints: [resolve(root, entry)],
		outfile: resolve(root, outfile),
		bundle: true,
		platform: "node",
		target: "node22",
		format: "esm",
		banner: { js: CREATE_REQUIRE_BANNER },
		sourcemap: false,
		// Deps are bundled rather than external: the launcher only ships this one
		// file into /opt, so a bare `import "hono"` at runtime would not resolve.
		packages: "bundle",
		logLevel: "info",
	})
	console.log(`built ${name} -> ${outfile}`)
}

// The drizzle migration journal, copied beside the migrate bundle.
//
// esbuild inlines JavaScript but leaves every other file type behind, and the
// migrator resolves its SQL folder relative to its own module URL. Without this
// copy the bundled migrator runs, finds no folder, and reports "no migrations
// found" — which is a SUCCESS-shaped failure: the schema silently never
// changes while the deploy prints "migrations applied".
const DRIZZLE_SRC = resolve(root, "packages/db/drizzle")
const DRIZZLE_DEST = resolve(root, "apps/api/dist/drizzle")

rmSync(DRIZZLE_DEST, { recursive: true, force: true })
mkdirSync(DRIZZLE_DEST, { recursive: true })
let copied = 0
for (const file of readdirSync(DRIZZLE_SRC)) {
	if (!file.endsWith(".sql")) continue
	copyFileSync(resolve(DRIZZLE_SRC, file), resolve(DRIZZLE_DEST, file))
	copied += 1
}
if (copied === 0) {
	// Loud, because the failure this prevents is silent.
	throw new Error(
		`no .sql files found in ${DRIZZLE_SRC} — the migrator would find an empty ` +
			`folder and report success while changing nothing`,
	)
}
console.log(`copied ${copied} migration(s) -> apps/api/dist/drizzle`)
