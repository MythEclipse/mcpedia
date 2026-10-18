/**
 * No service may serve browser HTML of its own.
 *
 * ## WHY THIS EXISTS
 *
 * The site presents itself as a plain wiki: no product name, no protocol, no
 * infrastructure vocabulary. `apps/web/src/lib/site.test.ts` enforces that over
 * the SPA's sources, and `apps/web/src/build/no-retired-branding.test.ts`
 * enforces it over the built SPA bundle. Neither could see the page that broke
 * the rule.
 *
 * `apps/api/src/dashboard.ts` was a self-contained HTML document — its own
 * `<title>`, its own `<h1>`, a BullMQ-labelled queue panel and an MCP search box
 * — served publicly from the API process at `/dashboard`, ahead of the SPA.
 * Both existing guards were green the whole time, and both were right about what
 * they covered: the leak was in a file neither of them walks. A scan of
 * `apps/web/src` cannot see a page typed into `apps/api/src`.
 *
 * ## WHAT THE INVARIANT ACTUALLY IS
 *
 * Not "no service source mentions a retired name". That would be wrong, not
 * strict: `@mcpedia` is the workspace scope in most imports, `mcpedia-index` is
 * the Redis queue key, `mcpedia_uptime_seconds` is a Prometheus metric a scraper
 * depends on, and `@mcpedia/config`'s startup errors are read by an OPERATOR
 * over SSH, not by a wiki reader. None of those reaches a browser.
 *
 * The invariant is narrower and sharper: **a service must not answer a browser
 * with markup it wrote itself.** The moment one does, there are two frontends
 * with two sets of copy, and only one of them is covered by the SPA's guards.
 * That is exactly the hole this page fell through.
 *
 * ## WHY IT ALSO CHECKS THE INLINE SCRIPT PARSES
 *
 * The deleted page had a second, independent defect that no naming check would
 * have caught: its `<script>` never parsed. The escape helper's map literal had
 * been written with three consecutive `"` characters — and a TEMPLATE literal
 * emits `\"` as a plain `"`, because a template literal needs no escaping for it
 * — so the browser received `{"""…}` and died at parse time. The queue, metrics
 * and search panels had therefore never populated, on a page that looked live
 * and reported nothing.
 *
 * `vm.Script` is the right instrument because it parses the REAL emitted bytes
 * with the REAL parser. `node --check` on the TypeScript source would not: the
 * string only becomes JavaScript after the template literal is evaluated, and
 * that evaluation is the step that turns `\"\"\"` into `"""`.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Script } from "node:vm"
import { describe, expect, it } from "vitest"

const API_SRC = dirname(fileURLToPath(import.meta.url))
const REPO = join(API_SRC, "..", "..", "..")

/**
 * Trees a browser can be answered from, minus the SPA.
 *
 * apps/web is excluded: it IS the frontend, and its own two guards cover it.
 * packages/ is included because that is where the .docx branding hid — a scan
 * scoped to one app cannot see a dependency.
 */
const SCANNED = [
	join(REPO, "apps", "api", "src"),
	join(REPO, "apps", "mcp", "src"),
	join(REPO, "apps", "worker", "src"),
	join(REPO, "apps", "mcp-client", "src"),
	join(REPO, "packages", "core", "src"),
	join(REPO, "packages", "db", "src"),
	join(REPO, "packages", "queue", "src"),
	join(REPO, "packages", "config", "src"),
	join(REPO, "packages", "parser", "src"),
	join(REPO, "packages", "types", "src"),
]

function sources(dir: string): string[] {
	const found: string[] = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name)
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") continue
			found.push(...sources(path))
			continue
		}
		if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name))
			continue
		found.push(path)
	}
	return found
}

/** Strip comments so a file cannot trip the scan by documenting the rule. */
function stripComments(code: string): string {
	return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

/**
 * Markup that means "this process answers a browser with a page".
 *
 * A document-level tag, not just any `<div>` — a string of fragments is not a
 * page, and an email template or an SVG is not served over HTTP by these
 * services.
 */
const DOCUMENT_MARKUP = /<!doctype html|<html[\s>]|<body[\s>]/i

/**
 * Hono's HTML response helper. The second angle on the same invariant: markup
 * could be read from a fixture at runtime, where the literal scan above would
 * not see it, but it still has to leave through this call.
 */
const HTML_RESPONSE = /\bc\.html\(/

/** Names that must not reach a wiki reader. */
const RETIRED = [
	/mcpedia/i,
	/\bMCP\b/,
	/\bmodel context protocol\b/i,
	/\bhindsight\b/i,
	/\bbullmq\b/i,
	/\btsvector\b/i,
]

const FILES = SCANNED.flatMap((dir) => {
	try {
		return sources(dir)
	} catch {
		return []
	}
})

const withText = FILES.map((file) => ({
	file,
	code: stripComments(readFileSync(file, "utf8")),
}))

describe("service-side HTML", () => {
	it("scans a non-trivial number of files", () => {
		// A guard on the guard: a broken walk would make the assertions below pass
		// over nothing at all, which is the one way this file can lie.
		expect(FILES.length).toBeGreaterThan(20)
	})

	it("no service writes its own HTML document", () => {
		const offenders = withText
			.filter(({ code }) => DOCUMENT_MARKUP.test(code))
			.map(({ file }) => file)
		expect(
			offenders,
			`a service is answering a browser with hand-written HTML: ${offenders.join(", ")}. ` +
				"That is a second frontend with its own copy, and no check over apps/web/src " +
				"can see it. Serve the page from the SPA instead — and if the service genuinely " +
				"needs HTML (an OAuth callback, a metric page), add it to this test's allowlist " +
				"with the reason, so it arrives deliberately rather than on a public URL.",
		).toEqual([])
	})

	it("no service answers HTML through Hono's c.html()", () => {
		const offenders = withText
			.filter(({ code }) => HTML_RESPONSE.test(code))
			.map(({ file }) => file)
		expect(
			offenders,
			`HTML leaves this service through c.html(): ${offenders.join(", ")}`,
		).toEqual([])
	})

	it("any HTML a service does emit carries no retired naming", () => {
		// Scoped to files that hold markup at all, so this cannot fire on the
		// package scope, the queue key or a Prometheus metric name — none of which
		// reaches a browser. Today zero files match and the assertion is vacuous
		// BY CONSTRUCTION, which is why the markup test above is the load-bearing
		// one: it is what keeps this at zero, and it fails loudly the moment a page
		// is written. Mutation-verified by restoring the deleted page.
		const hits: string[] = []
		for (const { file, code } of withText) {
			if (!DOCUMENT_MARKUP.test(code)) continue
			for (const pattern of RETIRED) {
				const found = code.match(new RegExp(pattern.source, "gi")) ?? []
				for (const m of found) hits.push(`${file}: ${m}`)
			}
		}
		expect(hits, `branded markup found in: ${hits.join(" | ")}`).toEqual([])
	})
})

describe("emitted inline scripts", () => {
	/**
	 * Every `<script>` body inside a template literal, evaluated the way the
	 * runtime evaluates it.
	 *
	 * Only `\"` and `\`` need undoing for this purpose: those are the sequences
	 * that change what the browser receives as code. A `\n` collapse would be
	 * cosmetic and irrelevant to whether the script parses.
	 */
	const inlineScripts = withText.flatMap(({ file, code }) => {
		const out: { file: string; script: string }[] = []
		for (const literal of code.matchAll(/`([^`]*)`/gs)) {
			const emitted = (literal[1] ?? "")
				.replace(/\\"/g, '"')
				.replace(/\\`/g, "`")
			for (const s of emitted.matchAll(
				/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi,
			)) {
				const script = s[1] ?? ""
				if (script.trim()) out.push({ file, script })
			}
		}
		return out
	})

	it("every inline script a service emits parses", () => {
		// One test rather than `it.each` over the matches: there are currently
		// ZERO (no service emits a script, which is the point of the suite above),
		// and `it.each([])` fails the whole FILE with "No test found in suite" —
		// a green invariant reported as a red run. This form passes over an empty
		// list and reports the offending file the moment one appears.
		const broken: string[] = []
		for (const { file, script } of inlineScripts) {
			try {
				new Script(script)
			} catch (error) {
				broken.push(`${file}: ${(error as Error).message}`)
			}
		}
		expect(
			broken,
			`an inline script does not parse, so that panel is dead in the browser: ${broken.join(" | ")}. ` +
				'Watch for a `\\"` sequence: a template literal emits it as a plain quote, ' +
				"so escaping inside one can produce syntactically invalid JavaScript that " +
				"only fails once the browser receives it.",
		).toEqual([])
	})
})
