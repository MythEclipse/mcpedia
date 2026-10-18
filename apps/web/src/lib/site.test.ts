/**
 * The site is presented as a plain wiki, with no product name in the reader's
 * view.
 *
 * ## WHY THIS FILE EXISTS
 *
 * A rename is the kind of change that gets applied to the files a person
 * remembers and misses the ones they don't. The two that are easiest to miss
 * here are both structural:
 *
 *   1. `index.html` is the STATIC shell. Nothing imports src/lib/site.ts from
 *      it, so its <title>, its meta description and the theme bootstrap's
 *      localStorage key are literals that can silently disagree with the rest
 *      of the app. A tab reading one name while the header reads another is a
 *      real failure that no typechecker can see.
 *
 *   2. Comments and doc blocks are excluded from the sweep on purpose (they
 *      discuss @mcpedia/* package names, which are correct and must not be
 *      renamed), so the guard has to distinguish "rendered string" from
 *      "prose about the packages". It does that by stripping comments before
 *      matching, and by allowing the package scope explicitly.
 *
 * The scan is over every TypeScript/TSX file under src/, not a hand-listed set,
 * for the same reason: a new file is exactly where the rule gets broken.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
	EXPORT_FALLBACK,
	SITE_DESCRIPTION,
	SITE_NAME,
	THEME_STORAGE_KEY,
} from "./site"

const SRC = dirname(dirname(fileURLToPath(import.meta.url)))
const WEB = dirname(SRC)

/**
 * Every .ts/.tsx file under src/ that can render copy.
 *
 * `src/build/` is excluded deliberately: it holds build-time Vite plugins
 * (the browser-bundle guard and the routing-dir guard), and their identifiers —
 * the plugin's own name and its compile-error prefix — are developer-facing
 * strings that never reach a browser. Excluding the directory is narrower than
 * letting "mcpedia" through the pattern, so every file that CAN render copy is
 * still checked.
 */
function sourceFiles(dir: string): string[] {
	const out: string[] = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (path === join(SRC, "build")) continue
			out.push(...sourceFiles(path))
			continue
		}
		if (!/\.tsx?$/.test(entry.name)) continue
		if (/\.test\.tsx?$/.test(entry.name)) continue
		out.push(path)
	}
	return out
}

/**
 * Strip comments so prose about `@mcpedia/*` is not mistaken for UI copy.
 *
 * Deliberately simple: block comments then line comments. A `//` inside a
 * string literal would be stripped too, which is why the assertion below
 * checks for RETIRED BRAND STRINGS rather than counting matches — a mangled
 * string that no longer contains the old name cannot produce a false failure,
 * and it also cannot hide one.
 */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")
}

/**
 * Package specifiers are not UI copy.
 *
 * `import type { DocumentMeta } from "@mcpedia/types"` is an internal module
 * path; renaming it would break the build, and rewriting it is not part of
 * presenting the site as a wiki. The scope is allowed explicitly rather than by
 * excluding whole files, so a file that mostly imports the packages is still
 * checked for the copy it renders.
 */
function withoutPackageScope(source: string): string {
	return source.replace(/@mcpedia\/[a-z-]+/g, "")
}

describe("site identity", () => {
	it("keeps the name out of the reader's view as a product", () => {
		// The name itself is not forbidden — a wiki may be called anything. What
		// is forbidden is the retired product name, in any casing.
		expect(SITE_NAME.toLowerCase()).not.toContain("mcpedia")
		expect(SITE_NAME.toLowerCase()).not.toBe("mcp")
	})

	it("does not describe itself as an agent or protocol client", () => {
		const description = SITE_DESCRIPTION.toLowerCase()
		for (const word of [
			"mcp",
			"model context protocol",
			"ai agent",
			"agent",
			"llm",
		]) {
			expect(description, `description mentions "${word}"`).not.toContain(word)
		}
	})
})

describe("index.html agrees with src/lib/site.ts", () => {
	// The static shell cannot import the constants, so this is the only thing
	// tying the two together.
	const html = readFileSync(join(WEB, "index.html"), "utf8")

	it("uses the site name as the document title", () => {
		// The <title> is a bare element with no other content, so this can
		// assert exact content rather than mere containment.
		const title = html.match(/<title>([^<]*)<\/title>/)?.[1]
		expect(title).toBe(SITE_NAME)
	})

	it("carries the shared meta description verbatim", () => {
		// Verbatim, not "contains a keyword": the description is what a search
		// result shows, and a paraphrase here is the drift this test exists for.
		expect(html).toContain(SITE_DESCRIPTION)
	})

	it("reads the theme preference from the shared storage key", () => {
		// Two readers of this key: the inline bootstrap (here) and ThemeToggle.
		// If they disagree the toggle appears to work and then reverts on reload.
		expect(html).toContain(`localStorage.getItem("${THEME_STORAGE_KEY}")`)
	})

	it("never mentions the retired product name", () => {
		expect(html.toLowerCase()).not.toContain("mcpedia")
	})
})

describe("no retired branding in rendered copy", () => {
	const files = sourceFiles(SRC)

	it("scans a non-trivial number of files", () => {
		// A guard on the guard: if the walk broke, every assertion below would
		// pass vacuously over an empty list.
		expect(files.length).toBeGreaterThan(30)
	})

	it("never renders the product name", () => {
		const offenders = files.filter((path) => {
			const source = withoutPackageScope(
				withoutComments(readFileSync(path, "utf8")),
			)
			return /mcpedia/i.test(source)
		})
		expect(offenders).toEqual([])
	})

	it("never renders the protocol or gateway jargon", () => {
		// "MCP", "Model Context Protocol" and the port reference were all
		// describing how the deployment is reachable, not what it contains.
		const offenders = files.filter((path) => {
			const source = withoutPackageScope(
				withoutComments(readFileSync(path, "utf8")),
			)
			return /model context protocol|mcpServers|:4021|\bMCP\b/.test(source)
		})
		expect(offenders).toEqual([])
	})

	it("never renders the infrastructure product names", () => {
		// A reader came for a page, not for the stack the page is served from.
		const offenders = files.filter((path) => {
			const source = withoutPackageScope(
				withoutComments(readFileSync(path, "utf8")),
			)
			return /hindsight|postgresql 16|bullmq|tsvector/i.test(source)
		})
		expect(offenders).toEqual([])
	})

	it("keeps the retired topology and config components deleted", () => {
		// Not merely unrendered: if the files come back, the sections they
		// supplied come back with them on the next edit.
		for (const name of ["InteractiveTopology", "McpConfigSnippet"]) {
			const matches = files.filter((path) => path.includes(name))
			expect(matches, `${name} still exists under src/`).toEqual([])
		}
	})

	it("uses the shared export fallback", () => {
		// The .docx export used to default to "mcpedia-export", which is the
		// name a reader would see in their downloads folder.
		const source = readFileSync(
			join(SRC, "components", "PdfExportView.tsx"),
			"utf8",
		)
		expect(source).toContain("EXPORT_FALLBACK")
		expect(EXPORT_FALLBACK.toLowerCase()).not.toContain("mcpedia")
	})

	it("passes the site name into the .docx metadata", () => {
		// The scan above covers apps/web/src only, and the .docx builder lives
		// in packages/core — which is exactly how the product name survived
		// there: it was hardcoded in the document creator, the description and
		// the running header. Core cannot import this constant, so the web
		// layer must supply it; this asserts it actually does.
		const source = readFileSync(join(SRC, "lib", "export-docx.ts"), "utf8")
		expect(source).toContain("siteName: SITE_NAME")
	})
})
