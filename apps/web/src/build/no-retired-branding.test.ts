/**
 * The shipped bundle carries no product or infrastructure naming.
 *
 * ## WHY THIS IS SEPARATE FROM src/lib/site.test.ts
 *
 * That test walks the SOURCE of apps/web/src, which cannot see two things:
 *
 *   1. Code pulled in from packages/*. The .docx export's document metadata
 *      (its `creator`, its description, its running header) lives in
 *      packages/core and shipped "MCPedia" into every reader's Word file
 *      properties. A source scan of apps/web src/ never looks there.
 *
 *   2. Anything that survives only after a transform or minify step — a name
 *      assembled at runtime, a string from a dependency, or a constant that
 *      gets inlined somewhere unexpected.
 *
 * So this asserts on dist/: the bytes a browser actually receives. It is the
 * only check that cannot be satisfied by editing the wrong copy.
 *
 * ## WHY IT REFUSES TO RUN AGAINST A STALE dist/, AND WHY THAT IS THE POINT
 *
 * Asserting on dist/ is only meaningful while dist/ is the build of the CURRENT
 * source. It is not always: `vite build` writes content-hashed filenames and
 * does not clean up hashes from a previous build, and moon will REPLAY a cached
 * build when it believes the inputs are unchanged — which it did here, after
 * packages/core/src/application/export.docx.ts was edited, because web's build
 * inputs are declared as this project's own sources and a dependency's source
 * is outside them.
 *
 * That combination produced a false pass in this very file: the product name
 * had been put back into packages/core, `moon run web:build` replayed a cached
 * bundle, and the assertions below ran green over bytes that no longer matched
 * the tree. A green check over a stale artifact is worse than no check, because
 * it is believed.
 *
 * So this does not trust dist/'s existence — it compares dist/'s newest
 * modification time against the newest source mtime in the projects that can
 * contribute to it, and FAILS with an instruction to rebuild rather than
 * asserting over bytes it cannot vouch for. Failing (not skipping) is
 * deliberate: the gate builds web before running the suite, so a stale dist on
 * CI is a real signal, and locally it is a two-second fix.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const SRC = dirname(dirname(fileURLToPath(import.meta.url)))
const WEB = dirname(SRC)
const DIST = join(WEB, "dist")
const ASSETS = join(DIST, "assets")

/**
 * Projects whose sources can end up in the web bundle.
 *
 * web itself plus everything it depends on per apps/web/moon.yml. `db` is in
 * that list there but contributes no runtime code to the browser (the guard in
 * src/build/no-server-imports.ts exists precisely to enforce that), so it is
 * omitted here — including it would only add false staleness signals.
 */
const CONTRIBUTING = [
	join(WEB, "src"),
	join(WEB, "index.html"),
	join(WEB, "vite.config.ts"),
	join(WEB, "..", "..", "packages", "core", "src"),
	join(WEB, "..", "..", "packages", "types", "src"),
	join(WEB, "..", "..", "packages", "config", "src"),
	join(WEB, "..", "..", "packages", "queue", "src"),
]

/** Newest mtime under a path, files only. Epoch ms. */
function newestMtime(path: string): number {
	if (!existsSync(path)) return 0
	const stat = statSync(path)
	if (stat.isFile()) return stat.mtimeMs
	let newest = 0
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		const child = join(path, entry.name)
		// node_modules and build output inside a package are not inputs.
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue
			newest = Math.max(newest, newestMtime(child))
			continue
		}
		newest = Math.max(newest, statSync(child).mtimeMs)
	}
	return newest
}

/** Newest mtime of the emitted assets. Epoch ms. */
function distMtime(): number {
	if (!existsSync(ASSETS)) return 0
	let newest = 0
	for (const name of readdirSync(ASSETS)) {
		if (!/\.(js|css)$/.test(name)) continue
		newest = Math.max(newest, statSync(join(ASSETS, name)).mtimeMs)
	}
	return newest
}

/**
 * Retired names, as they would appear if they leaked into the UI.
 *
 * Case-insensitive for the brand; the protocol and stack terms are matched as
 * words so an incidental substring does not fire. ":4021" is the gateway port,
 * which was rendered in the footer and on the dashboard.
 */
const RETIRED = [
	/mcpedia/i,
	/\bMCP\b/,
	/model context protocol/i,
	/:4021/,
	/\bhindsight\b/i,
	/\bbullmq\b/i,
	/\btsvector\b/i,
	/postgresql 16/i,
	/\bmcpServers\b/,
]

/** Every emitted asset, concatenated — the browser's whole view. */
function bundleText(): string {
	return readdirSync(ASSETS)
		.filter((name) => /\.(js|css)$/.test(name))
		.map((name) => readFileSync(join(ASSETS, name), "utf8"))
		.join("\n")
}

const built = existsSync(ASSETS) && readdirSync(ASSETS).length > 0

describe("the shipped bundle", () => {
	// dist/ is gitignored, so a checkout that has not been built has nothing to
	// assert against. The gate builds web before the suite (scripts:check runs
	// build:bundles and web:build), so this skip is a local convenience only.
	it.skipIf(!built)("is not stale relative to its sources", () => {
		const newestSource = Math.max(...CONTRIBUTING.map(newestMtime))
		// One second of slack: a build and the mtime write can land in the same
		// filesystem timestamp tick, and a false staleness failure would be
		// worse than the check is worth.
		const tolerance = 1000
		expect(
			distMtime() + tolerance >= newestSource,
			"dist/ is older than the sources it would be built from — the assertions " +
				"below cannot vouch for it. Rebuild with `moon run web:build --force` " +
				"(a plain `moon run web:build` may replay a cached bundle).",
		).toBe(true)
	})

	it.skipIf(!built)("has a build worth inspecting", () => {
		// A guard on the guard: an empty or tiny asset list would make every
		// assertion below pass over nothing.
		expect(bundleText().length).toBeGreaterThan(50_000)
	})

	for (const pattern of RETIRED) {
		it.skipIf(!built)(`never ships ${pattern}`, () => {
			const matches = bundleText().match(new RegExp(pattern.source, "gi")) ?? []
			// The message names what was found, because "expected [...] to be
			// empty" does not say which string or which casing.
			expect(matches, `found in dist/assets: ${matches.join(", ")}`).toEqual([])
		})
	}

	it.skipIf(!built)("still ships the site's own copy", () => {
		// The inverse assertion. Without it, deleting the brand entirely — an
		// empty header, a blank title — would satisfy every check above.
		const text = bundleText()
		expect(text).toContain("Browse by section")
		expect(text).toContain("Search the wiki")
	})
})
