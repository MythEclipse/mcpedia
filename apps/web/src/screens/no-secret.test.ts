import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * THE SECURITY PROPERTY OF THIS PORT, as a test.
 *
 * The Next app rendered WEBHOOK_SECRET into the page and posted it as an
 * `x-webhook-secret` header from the browser. This port's reason for existing,
 * on the auth side, is that the SPA must NOT do that: the write gate stays
 * exactly as it is, and the browser proves who it is with a session cookie it
 * never gets to read.
 *
 * The invariant is structural and cheap to assert: no file under src/ may
 * IMPORT the secret's module, or SEND the header. Nothing else in the suite
 * would notice a regression here, because sending a header from the browser is
 * not a runtime error — it is a disclosure.
 *
 * WHAT IS AND IS NOT MATCHED. These assertions deliberately look at executable
 * constructs (import declarations, `headers:` in a fetch/init object) and not at
 * raw text: several of these files carry doc comments that NAME the secret and
 * the header precisely to explain why they do not use them, and a grep-shaped
 * test would fail on its own documentation. The build-time guard in
 * src/build/no-server-imports.ts is the other half of this — it denies the
 * @mcpedia/* packages at bundle time; this covers the leaks it cannot see,
 * because a browser can send a header without importing anything at all.
 */

const SRC = join(dirname(new URL(import.meta.url).pathname), "..")

function read(rel: string): string {
	return readFileSync(join(SRC, rel), "utf8")
}

/** Every non-test .ts/.tsx file under src/. */
function sourceFiles(): string[] {
	const files: string[] = []
	const walk = (dir: string): void => {
		for (const entry of readdirSync(join(SRC, dir), { withFileTypes: true })) {
			const rel = `${dir}/${entry.name}`
			if (entry.isDirectory()) walk(rel)
			else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
				files.push(rel)
		}
	}
	walk(".")
	return files
}

/**
 * Strip comments and string literals, leaving executable code.
 *
 * A crude but sufficient scrub: the things being looked for (`headers:`,
 * `import ... from`) only carry meaning in code, and this keeps a doc comment
 * from being mistaken for a violation.
 */
function code(src: string): string {
	return (
		src
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/(^|[^:])\/\/[^\n]*/g, "$1")
			// Drop template literals and quoted strings (doc text lives there too).
			.replace(/`(?:[^`\\]|\\.)*`/g, "``")
			.replace(/"(?:[^"\\]|\\.)*"/g, '""')
			.replace(/'(?:[^'\\]|\\.)*'/g, "''")
	)
}

/** The module specifiers a file imports. */
function importSpecifiers(src: string): string[] {
	const codeOnly = code(src)
	return [
		...[...codeOnly.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]),
		...[...codeOnly.matchAll(/\bimport\s+["']([^"']+)["']/g)].map((m) => m[1]),
	]
}

describe("the SPA never holds the webhook secret", () => {
	const files = sourceFiles()
	const offenders: string[] = []

	for (const file of files) {
		const src = read(file)
		for (const spec of importSpecifiers(src)) {
			if (/@mcpedia\/(config|db|core|queue)\b/.test(spec)) {
				offenders.push(`${file} imports ${spec}`)
			}
			if (/auth-server/.test(spec)) {
				offenders.push(`${file} imports ${spec}`)
			}
		}
	}

	it("found the source tree", () => {
		expect(files.length).toBeGreaterThan(5)
	})

	it("imports no secret-bearing module", () => {
		expect(offenders).toEqual([])
	})

	it("sends no credential header from anywhere in src/", () => {
		// `headers:` alone is not a violation — the RPC transport legitimately
		// sets Content-Type. What must never appear is an Authorization-ish or
		// webhook-secret header being attached by browser code.
		const leaked: string[] = []
		for (const file of files) {
			const codeOnly = code(read(file))
			// Look inside header OBJECTS for a credential-valued key.
			for (const m of codeOnly.matchAll(/headers\s*:\s*\{([^}]*)\}/g)) {
				if (/secret|authorization|cookie/i.test(m[1])) {
					leaked.push(`${file}: ${m[1].trim()}`)
				}
			}
			// Or any call that passes a credential as a header option.
			if (/"x-webhook-secret"/.test(codeOnly)) {
				leaked.push(`${file}: names x-webhook-secret in code`)
			}
		}
		expect(leaked).toEqual([])
	})

	it("specifically never imports @mcpedia/config", () => {
		// config's "." barrel reads .env off disk AND exports WEBHOOK_SECRET. The
		// build guard denies it at bundle time; this pins the same intent at the
		// source level, where the guard's allow-list could later be widened.
		expect(files.length).toBeGreaterThan(0)
		for (const file of files) {
			expect(importSpecifiers(read(file)), file).not.toContain(
				"@mcpedia/config",
			)
		}
	})
})

describe("DocForm does not accept a secret", () => {
	// Code-only for the "no secret prop" rule (so a doc comment NAMES it without
	// tripping the test), raw for the procedure paths (the scrubber removes the
	// string literals those paths are made of).
	const raw = read("screens/doc-form.tsx")
	const codeOnly = code(raw)

	it("declares no secret prop", () => {
		// Not renamed, not optional — absent, so no future caller can pass it back.
		expect(codeOnly).toMatch(/interface DocFormProps/)
		expect(codeOnly).not.toMatch(/secret\??\s*:\s*string/)
		expect(codeOnly).not.toMatch(/\bsecret\b\s*,/)
	})

	it("calls the gated procedures directly", () => {
		expect(raw).toMatch(/\["documents", "create"\]/)
		expect(raw).toMatch(/\["documents", "update"\]/)
	})
})

describe("the write gate stays where it was", () => {
	it("is still enforced server-side and fail-closed", () => {
		// The API is outside this task's write scope. Asserting on its source is
		// a tripwire: if someone later relaxes the gate to accept a logged-in
		// browser carrying no credential, this fails.
		const middleware = readFileSync(
			join(SRC, "../../api/src/presentation/middleware.ts"),
			"utf8",
		)
		expect(middleware).toMatch(/export const requireWriteAuth/)
		expect(middleware).toMatch(/not-configured/)
		expect(middleware).toMatch(/invalid-secret/)
		// Still refuses when the secret is unset, rather than falling through.
		expect(middleware).toMatch(/if\s*\(\s*!ctx\.expectedSecret\s*\)/)
		expect(middleware).toMatch(/return next\(\)/)
	})

	it("leaves the MCP x-webhook-secret path untouched", () => {
		// apps/mcp keeps its own header check. The task required this file to be
		// left completely alone, and it is outside apps/web entirely.
		const mcp = readFileSync(join(SRC, "../../mcp/src/index.ts"), "utf8")
		expect(mcp).toMatch(/x-webhook-secret/)
	})
})
