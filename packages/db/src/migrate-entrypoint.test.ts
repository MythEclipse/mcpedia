/**
 * The migration module must stay a LIBRARY, and the deploy must bundle exactly
 * one entrypoint.
 *
 * ## WHY THIS IS A TEST AND NOT A COMMENT
 *
 * `packages/db/src/migrate.ts` used to be both a library and a runnable script,
 * with the standard direct-invocation guard:
 *
 *     const isEntrypoint = import.meta.url === pathToFileURL(process.argv[1]).href
 *     if (isEntrypoint) main()
 *
 * That idiom is correct for unbundled Node and unsound the moment esbuild
 * inlines two modules into one file. The production `migrate.js` bundle contains
 * both this module and `apps/api/src/migrate.ts`, so both modules shared ONE
 * `import.meta.url`, BOTH guards compared equal, and BOTH ran the migration.
 *
 * The observable damage was a failed deploy — `migration failed: Failed query:
 * insert into "sections" ...` on the last seed row. Two migrators raced a single
 * shared `client`; the first to finish called `await client.end()`, closing the
 * pool under the second, whose in-flight insert then died with a bare Drizzle
 * "Failed query" and no SQLSTATE (`CONNECTION_ENDED`). Nothing in CI failed,
 * because CI never runs the bundle — it only builds it.
 *
 * So the rule is asserted against the SOURCE and the BUNDLER, which are the two
 * places the mistake can be caught before a real deploy.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../..")

const migrateLib = () =>
	readFileSync(join(REPO, "packages/db/src/migrate.ts"), "utf8")
const migrateEntry = () =>
	readFileSync(join(REPO, "apps/api/src/migrate.ts"), "utf8")
const bundler = () =>
	readFileSync(join(REPO, "scripts/build-bundles.mjs"), "utf8")

/** Strip `//` and `/* *\/` comments, so a rule is not matched by its own docs. */
function executableLines(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.split("\n")
		.filter((line) => !line.trim().startsWith("//"))
		.join("\n")
}

describe("packages/db/src/migrate.ts stays a pure library", () => {
	it("exports runMigrations", () => {
		expect(executableLines(migrateLib())).toContain(
			"export async function runMigrations",
		)
	})

	it("carries NO direct-invocation guard", () => {
		// The guard is what made a second migrator run. Its absence is the fix:
		// with only one entrypoint left, there is nothing to disambiguate.
		const body = executableLines(migrateLib())
		expect(body).not.toContain("isEntrypoint")
		expect(body).not.toContain("process.argv[1]")
		expect(body).not.toContain("pathToFileURL")
	})

	it("has no top-level main() that runs on import", () => {
		// A library that migrates on import would fire in every consumer — the
		// API server, a test, a script — which is a worse version of the same
		// bug. Asserted on the executable body so the docstring above, which
		// discusses `main()` at length, cannot satisfy or trip it.
		const body = executableLines(migrateLib())
		expect(body).not.toMatch(/^(async\s+)?function\s+main\b/m)
		// No bare top-level `main()` call either.
		expect(body).not.toMatch(/^main\(\)/m)
	})
})

describe("apps/api/src/migrate.ts is the ONE entrypoint", () => {
	it("runs at module scope, since nothing else will", () => {
		// It is the sole entrypoint now, so it must be unconditional. If this
		// were ever given a guard like the one removed above, the deploy would
		// bundle a file that does nothing at all — a silent, green no-op that
		// stops the schema from ever migrating.
		const body = executableLines(migrateEntry())
		expect(body).toMatch(/^main\(\)/m)
		expect(body).not.toContain("isEntrypoint")
	})
})

describe("the bundler asserts one entrypoint per bundle", () => {
	it("carries an entrypoint guard that can fail the build", () => {
		const body = bundler()
		expect(body).toContain("ENTRYPOINT_MARKERS")
		// It must THROW, not warn: a warning in CI is a log line nobody reads,
		// and this bug's whole character is failing only in production.
		expect(body).toMatch(/throw new Error\(\s*`\$\{file\}/)
	})

	it("checks the marker that actually counted 2 while the bug was live", () => {
		// `migration failed:` appeared twice in the broken bundle — once in the
		// library's own catch, once in the entrypoint's. It is the tripwire, so
		// it is pinned by name rather than left to drift.
		const body = bundler()
		expect(body).toContain('marker: "migration failed:"')
		expect(body).toContain("expected: 1")
	})
})
