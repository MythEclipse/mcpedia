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
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"

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

/**
 * ONE ENTRYPOINT PER BUNDLE — asserted, because bundling silently breaks the
 * idiom that used to guarantee it.
 *
 * `packages/db/src/migrate.ts` was a library AND had a local `main()` guarded by
 * `import.meta.url === pathToFileURL(process.argv[1]).href` — the standard
 * "run only when invoked directly" check, and correct for unbundled Node.
 * esbuild inlines that module and `apps/api/src/migrate.ts` into ONE file, so
 * both modules shared a single `import.meta.url`, BOTH guards compared equal,
 * and BOTH ran the migration.
 *
 * The result was a failed production deploy: two migrators racing one shared
 * `client`, the first to finish calling `await client.end()` and closing the
 * pool under the second, whose in-flight insert died with a bare Drizzle
 * "Failed query" and no SQLSTATE (`CONNECTION_ENDED`) on the last seed row.
 *
 * The duplicate entrypoint is gone now, so this counts the markers that must
 * appear exactly once and fails the BUILD if a second one ever appears — which
 * is the only place the mistake can still be caught, since the broken bundle
 * otherwise runs happily in CI and only fails on a real deploy.
 *
 * Note the markers are strings the ENTRYPOINT owns. A library may legitimately
 * be imported many times; what must be unique is the code that decides to run.
 */
const ENTRYPOINT_MARKERS = [
	{
		bundle: "migrate",
		file: "apps/api/dist/migrate.js",
		// apps/api/src/migrate.ts's catch block. The removed library main() had
		// its own, distinct one, so this counted 2 while the bug was live.
		marker: "migration failed:",
		expected: 1,
	},
	{
		bundle: "migrate",
		file: "apps/api/dist/migrate.js",
		// The direct-invocation idiom itself. Bundling makes it unsound, so no
		// bundle may carry it at all — if one does, some module is trying to be
		// a second entrypoint and will succeed at it.
		marker: "isEntrypoint",
		expected: 0,
	},
]

for (const { bundle, file, marker, expected } of ENTRYPOINT_MARKERS) {
	const abs = resolve(root, file)
	const body = readFileSync(abs, "utf8")
	// Counted by plain substring occurrence. The markers are literal strings
	// from the entrypoint's own source and no identifier in the bundle contains
	// them as a prefix, so `split().length` is exact here — and if a dependency
	// ever did contain one, the guard would fire loudly rather than miss the
	// duplicate, which is the failure direction to prefer.
	const found = body.split(marker).length - 1
	if (found !== expected) {
		throw new Error(
			`${file}: expected ${expected} occurrence(s) of ${JSON.stringify(marker)} ` +
				`for bundle "${bundle}", found ${found}. More than one means a second ` +
				`entrypoint got bundled in — the failure mode that shipped two ` +
				`concurrent migrators and broke a deploy. See the note above.`,
		)
	}
}
console.log(
	`entrypoint check: ${ENTRYPOINT_MARKERS.length} marker(s) as expected in the migrate bundle`,
)

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
