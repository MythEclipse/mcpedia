import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

/**
 * `.env.example` must document exactly the variables the config layer resolves.
 *
 * ## WHY THIS IS A TEST AND NOT A CONVENTION
 *
 * `.dockerignore` carried a `!.env.example` negation for a file that did not
 * exist, so the template was advertised, absent, and nothing noticed — the
 * negation is inert either way, which is exactly why nothing did. Meanwhile the
 * config layer has grown and dropped variables over time (the `EMBED_*` trio is
 * gone, replaced by hindsight), and every one of those changes had to be
 * hand-copied into a template that was not there.
 *
 * A template that silently omits a variable is how a deploy ends up missing one,
 * and the failure surfaces far from the cause. So the relationship is enforced
 * rather than trusted.
 *
 * ## WHY IT PARSES THE SOURCE INSTEAD OF IMPORTING IT
 *
 * Importing `./index.ts` would read the ambient environment and the developer's
 * real `.env`, so the test would pass or fail on the machine's config rather
 * than on the repository's. Both files are read as TEXT and their key lists
 * compared, which is a property of the repo and is stable everywhere.
 */

const repoRoot = new URL("../../../", import.meta.url)
const source = readFileSync(new URL("index.ts", import.meta.url), "utf8")
const template = readFileSync(new URL(".env.example", repoRoot), "utf8")

/** Keys the schema names, in the order `EnvSchema.safeParse` resolves them. */
function schemaKeys(): string[] {
	const parseBlock = source.slice(
		source.indexOf("EnvSchema.safeParse({"),
		source.indexOf("})", source.indexOf("EnvSchema.safeParse({")),
	)
	return [...parseBlock.matchAll(/^\s*([A-Z][A-Z0-9_]*):/gm)].map(
		(m) => m[1] ?? "",
	)
}

/** Keys documented in the template: assignments only, never the prose comments. */
function documentedKeys(): string[] {
	return [...template.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1] ?? "")
}

describe(".env.example", () => {
	test("the schema block was actually found", () => {
		// A guard on the guard: if the parse block is renamed the regexes above
		// silently return nothing, every comparison below passes vacuously, and
		// the test becomes a no-op that still reports green.
		const keys = schemaKeys()
		expect(
			keys.length,
			"no keys parsed out of config/index.ts",
		).toBeGreaterThan(5)
		expect(keys).toContain("DATABASE_URL")
	})

	test("documents every variable the config layer resolves", () => {
		const missing = schemaKeys().filter((k) => !documentedKeys().includes(k))
		expect(
			missing,
			`add these to .env.example with a comment saying what breaks without them: ${missing.join(", ")}`,
		).toEqual([])
	})

	test("documents nothing the config layer does not resolve", () => {
		// The other direction matters as much: a template variable that nothing
		// reads is a decoy that sends an operator hunting for its effect. This is
		// how the removed EMBED_* trio would come back.
		const schema = schemaKeys()
		const extra = documentedKeys().filter((k) => !schema.includes(k))
		expect(extra, `nothing reads these: ${extra.join(", ")}`).toEqual([])
	})

	test("no secret ships with a real-looking default", () => {
		// Every value that must be generated is left EMPTY, so an operator cannot
		// deploy a template unedited and believe it is configured. URLs and names
		// may carry a working local default; secrets may not.
		for (const key of [
			"BETTER_AUTH_SECRET",
			"WEBHOOK_SECRET",
			"ADMIN_PASSWORD",
		]) {
			const line =
				template.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1] ?? "MISSING"
			expect(line, `${key} must be blank in the template`).toBe("")
		}
	})

	test("is not swallowed by the .env* ignore globs", () => {
		// The actual reason this file did not exist. `.env*` in .gitignore matches
		// `.env.example`, so a template can be written, work locally, and never be
		// committed — while .dockerignore's `!.env.example` sits there implying it
		// is tracked. The failure is invisible: `git status` shows nothing, because
		// an ignored file is not a missing file.
		//
		// Checked here rather than left to review because the symptom (a new
		// checkout has no template) appears only on someone else's machine.
		const gitignore = readFileSync(new URL(".gitignore", repoRoot), "utf8")
		const ignoreLines = gitignore
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l !== "" && !l.startsWith("#"))
		const negated = ignoreLines.includes("!.env.example")
		expect(
			negated,
			".gitignore ignores .env.example — add `!.env.example` after the `.env*` line",
		).toBe(true)
		// And the negation must come AFTER the pattern it un-ignores, or git never
		// reaches it: last match wins.
		expect(ignoreLines.indexOf("!.env.example")).toBeGreaterThan(
			ignoreLines.indexOf(".env*"),
		)
	})
})
