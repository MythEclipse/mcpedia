/**
 * Build-time guard: the browser bundle must never reach a server package.
 *
 * WHY THIS EXISTS. Every workspace package under packages/ ships RAW TypeScript
 * through its `exports` map — `{".": "./src/index.ts"}`. There is no build step
 * and no "browser" condition to fall back on, so a plain value import of
 * `@mcpedia/db` from anything under src/ resolves straight to the Postgres
 * driver and gets bundled into a browser download. It does not fail loudly:
 * `postgres`, `bullmq` and `node:fs` all transpile fine and the break only
 * shows up at runtime as an unhandled rejection in the user's tab.
 *
 * Type-only imports are safe — `import type` is erased before any resolver
 * runs, so these packages never appear in the module graph at all. That is
 * exactly why this plugin can be unconditional: anything that DOES reach
 * `resolveId` is a runtime import by definition.
 *
 * The rule is FAIL-CLOSED. Anything under the @mcpedia scope that is not on the
 * allow-list is rejected, so adding a new package to packages/ cannot quietly
 * become browser-reachable without an explicit, reviewable decision here.
 */
import type { Plugin } from "vite"

/** @mcpedia entry points that are proven safe to run in a browser. */
export const BROWSER_SAFE = [
	// Pure type declarations — no runtime code at all.
	"@mcpedia/types",
	// config/sections has zero imports (config's "." barrel pulls node:fs, which
	// is why the bare specifier below is denied while this subpath is not).
	"@mcpedia/config/sections",
	// core/export-helpers is a STATELESS formatting/sorting module. This entry
	// was added for the /export/pdf port, which needs extractDocCategory /
	// extractDocPoints / extractDocDifficulty / sortExportDocuments /
	// compileExportMarkdown in the browser: the export toolbar's sort and
	// category filter are client state, so re-sorting a locally-held document
	// list cannot go through the API without a round trip per keystroke.
	//
	// It is safe by the same standard as config/sections, and the audit is
	// mechanical rather than a judgement call. packages/core/src/export.helpers.ts
	// has exactly TWO import statements in the whole file:
	//     import { getSectionMeta } from "@mcpedia/config/sections"   <- already allowed
	//     import type { ... } from "@mcpedia/types"                 <- erased at compile time
	// So its transitive runtime graph is a single allow-listed, zero-import,
	// side-effect-free module. It does NOT touch @mcpedia/db, and it is not the
	// package barrel — core's "." entry is @mcpedia/core/src/index.ts, which
	// pulls Postgres, and stays denied. The distinction is pinned by tests in
	// no-server-imports.test.ts, which assert both that this subpath is allowed
	// AND that the "." barrel above it still is not.
	"@mcpedia/core/export-helpers",
] as const

/**
 * Server-only packages, denied explicitly. Listed for the error message only —
 * the allow-list below is what actually decides.
 */
export const SERVER_ONLY = [
	"@mcpedia/core",
	"@mcpedia/db",
	"@mcpedia/queue",
	"@mcpedia/search",
	"@mcpedia/embeddings",
	"@mcpedia/parser",
] as const

/** Strip Vite's `?v=` / `?import` suffixes before matching a specifier. */
function bare(source: string): string {
	const query = source.indexOf("?")
	return query === -1 ? source : source.slice(0, query)
}

/**
 * Returns null when the specifier is allowed, or a human-readable reason when
 * it is not. Exported separately from the plugin so the vitest guard can assert
 * against the same decision function the build uses — one source of truth.
 */
export function rejectionReason(source: string): string | null {
	const spec = bare(source)
	if (!spec.startsWith("@mcpedia/")) return null
	if ((BROWSER_SAFE as readonly string[]).includes(spec)) return null
	return (
		`'${spec}' is a server-only package and cannot be imported from the Vite ` +
		`browser bundle. It pulls in Postgres/Redis and node:fs. Import its TYPES ` +
		`with \`import type\` (erased at compile time, so it is safe), or call the ` +
		`API instead: the oRPC surface is proxied at /rpc and /trpc in dev.`
	)
}

/** Vite plugin form of the guard. Fails the build, naming the offending file. */
export function noServerImports(): Plugin {
	return {
		name: "mcpedia:no-server-imports",
		enforce: "pre",
		resolveId(source, importer) {
			const reason = rejectionReason(source)
			if (!reason) return null
			const from = importer ? `\n  imported from: ${importer}` : ""
			throw new Error(`[mcpedia] browser bundle guard\n\n  ${reason}${from}`)
		},
	}
}
